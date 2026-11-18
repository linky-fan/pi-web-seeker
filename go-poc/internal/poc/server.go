package poc

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxRequestBodyBytes = 128 * 1024

type Server struct {
	config  Config
	manager *Manager
	mux     *http.ServeMux
}

type createSessionRequest struct {
	CWD     string `json:"cwd"`
	Message string `json:"message"`
}

type promptRequest struct {
	Message string `json:"message"`
}

func NewServer(config Config, manager *Manager) http.Handler {
	server := &Server{config: config, manager: manager, mux: http.NewServeMux()}
	server.mux.HandleFunc("/healthz", server.handleHealth)
	server.mux.HandleFunc("/api/sessions", server.handleSessions)
	server.mux.HandleFunc("/api/sessions/", server.handleSession)
	return server.authenticate(server.validateLoopbackRequests(server.mux))
}

func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.config.AccessToken == "" {
			next.ServeHTTP(w, r)
			return
		}
		const prefix = "Bearer "
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, prefix) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		provided := strings.TrimSpace(strings.TrimPrefix(header, prefix))
		if subtle.ConstantTimeCompare([]byte(provided), []byte(s.config.AccessToken)) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) validateLoopbackRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.config.AccessToken == "" {
			if !isLoopbackHost(requestHostname(r.Host)) {
				writeError(w, http.StatusForbidden, "non-loopback Host is not allowed without authentication")
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" {
				parsed, err := url.Parse(origin)
				if err != nil || !isLoopbackHost(parsed.Hostname()) {
					writeError(w, http.StatusForbidden, "non-loopback Origin is not allowed without authentication")
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func requestHostname(host string) string {
	if hostname, _, err := net.SplitHostPort(host); err == nil {
		return strings.Trim(hostname, "[]")
	}
	return strings.Trim(host, "[]")
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var request createSessionRequest
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !validPrompt(request.Message) {
		writeError(w, http.StatusBadRequest, "message is required and must be at most 64 KiB")
		return
	}

	cwd := request.CWD
	if strings.TrimSpace(cwd) == "" {
		cwd = s.config.DefaultCWD
	}
	resolved, err := resolveWorkspace(cwd, s.config.AllowedRoots)
	if err != nil {
		writeError(w, http.StatusForbidden, "workspace is outside allowed roots or unavailable")
		return
	}

	session, err := s.manager.Create(resolved)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "could not start Pi RPC session")
		return
	}
	if err := session.SendPrompt(request.Message); err != nil {
		s.manager.Remove(session.ID)
		writeError(w, http.StatusServiceUnavailable, "could not submit initial prompt")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"sessionId": session.ID})
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	remainder := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/sessions/"), "/")
	parts := strings.Split(remainder, "/")
	if len(parts) == 0 || parts[0] == "" || len(parts) > 2 {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	session, ok := s.manager.Get(parts[0])
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	if len(parts) == 2 && parts[1] == "events" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleEvents(w, r, session)
		return
	}
	if len(parts) == 2 && parts[1] == "prompt" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		var request promptRequest
		if err := decodeJSON(w, r, &request); err != nil || !validPrompt(request.Message) {
			writeError(w, http.StatusBadRequest, "message is required and must be at most 64 KiB")
			return
		}
		if err := session.SendPrompt(request.Message); err != nil {
			writeError(w, http.StatusConflict, "session is no longer running")
			return
		}
		w.WriteHeader(http.StatusAccepted)
		return
	}
	if len(parts) == 1 && r.Method == http.MethodDelete {
		s.manager.Remove(session.ID)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeError(w, http.StatusNotFound, "session endpoint not found")
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request, session *Session) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming is unavailable")
		return
	}
	var after uint64
	if raw := r.Header.Get("Last-Event-ID"); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid Last-Event-ID")
			return
		}
		after = parsed
	}

	replay, live, unsubscribe, truncated := session.subscribe(after)
	defer unsubscribe()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	if truncated {
		_, _ = io.WriteString(w, ": replay window truncated\n\n")
	}
	_, _ = io.WriteString(w, ": connected\n\n")
	flusher.Flush()

	for _, event := range replay {
		if err := writeSSE(w, flusher, event); err != nil {
			return
		}
	}

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event, open := <-live:
			if !open {
				return
			}
			if err := writeSSE(w, flusher, event); err != nil {
				return
			}
		case <-heartbeat.C:
			if _, err := io.WriteString(w, ": keep-alive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func writeSSE(w http.ResponseWriter, flusher http.Flusher, event Event) error {
	if _, err := fmt.Fprintf(w, "id: %d\ndata: %s\n\n", event.ID, event.Data); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) error {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return errors.New("Content-Type must be application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
