package poc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestResolveWorkspaceRequiresAllowedRoot(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "workspace")
	outside := t.TempDir()
	if err := os.Mkdir(inside, 0o700); err != nil {
		t.Fatal(err)
	}

	got, err := resolveWorkspace(inside, []string{root})
	if err != nil {
		t.Fatalf("expected workspace inside root to be allowed: %v", err)
	}
	if got != inside {
		t.Fatalf("resolved path = %q, want %q", got, inside)
	}
	if _, err := resolveWorkspace(outside, []string{root}); err == nil {
		t.Fatal("expected workspace outside root to be rejected")
	}
}

func TestResolveWorkspaceRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(root, "outside-link")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := resolveWorkspace(link, []string{root}); err == nil {
		t.Fatal("expected symlink escape to be rejected")
	}
}

func TestAuthRequiresConfiguredBearerToken(t *testing.T) {
	handler := NewServer(
		Config{AccessToken: "test-token"},
		NewManager(Config{}),
	)

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}

	authorizedRequest := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	authorizedRequest.Header.Set("Authorization", "Bearer test-token")
	authorized := httptest.NewRecorder()
	handler.ServeHTTP(authorized, authorizedRequest)
	if authorized.Code != http.StatusOK {
		t.Fatalf("authorized status = %d, want %d", authorized.Code, http.StatusOK)
	}
}

func TestUnauthenticatedLoopbackRejectsRemoteHostAndOrigin(t *testing.T) {
	handler := NewServer(Config{}, NewManager(Config{}))
	requests := map[string]*http.Request{
		"remote host":   httptest.NewRequest(http.MethodGet, "http://attacker.example/healthz", nil),
		"remote origin": httptest.NewRequest(http.MethodGet, "http://localhost/healthz", nil),
	}
	requests["remote origin"].Header.Set("Origin", "https://attacker.example")
	for name, request := range requests {
		t.Run(name, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
			}
		})
	}

	localRequest := httptest.NewRequest(http.MethodGet, "http://localhost/healthz", nil)
	localResponse := httptest.NewRecorder()
	handler.ServeHTTP(localResponse, localRequest)
	if localResponse.Code != http.StatusOK {
		t.Fatalf("loopback status = %d, want %d", localResponse.Code, http.StatusOK)
	}
}

func TestCreateSessionRequiresJSONContentType(t *testing.T) {
	handler := NewServer(Config{}, NewManager(Config{}))
	request := httptest.NewRequest(
		http.MethodPost,
		"http://localhost/api/sessions",
		strings.NewReader(`{"cwd":"/workspace","message":"hello"}`),
	)
	request.Header.Set("Content-Type", "text/plain")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestCreatePromptStreamOverSSE(t *testing.T) {
	t.Setenv("PI_GO_POC_HELPER", "1")
	root := t.TempDir()
	manager := NewManager(Config{})
	manager.launchError = nil
	manager.launcher = PiLauncher{
		Executable: os.Args[0],
		Args:       []string{"-test.run=^TestPiRPCChildProcess$", "--", "--mode", "rpc", "--no-session"},
	}
	defer manager.CloseAll()

	handler := NewServer(Config{
		ProjectRoot:  root,
		AllowedRoots: []string{root},
		DefaultCWD:   root,
	}, manager)
	server := httptest.NewServer(handler)
	defer server.Close()

	body, err := json.Marshal(map[string]string{
		"cwd":     root,
		"message": "hello from the test",
	})
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.Post(server.URL+"/api/sessions", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		data, _ := io.ReadAll(response.Body)
		t.Fatalf("create status = %d, body = %s", response.StatusCode, data)
	}

	var created struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.SessionID == "" {
		t.Fatal("session ID is empty")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		server.URL+"/api/sessions/"+created.SessionID+"/events",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	stream, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()

	scanner := bufio.NewScanner(stream.Body)
	found := false
	for scanner.Scan() {
		if strings.Contains(scanner.Text(), `"type":"message_update"`) {
			found = true
			cancel()
			break
		}
	}
	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("did not receive the fake Pi message_update event over SSE")
	}
}

func TestPiRPCChildProcess(t *testing.T) {
	if os.Getenv("PI_GO_POC_HELPER") != "1" {
		return
	}
	scanner := bufio.NewScanner(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	for scanner.Scan() {
		var command struct {
			ID      uint64 `json:"id"`
			Type    string `json:"type"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &command); err != nil {
			continue
		}
		if command.Type != "prompt" {
			continue
		}
		for _, event := range []any{
			map[string]any{"type": "agent_start"},
			map[string]any{
				"type": "message_update",
				"message": map[string]any{
					"content": []any{map[string]any{"type": "text", "text": "fake response"}},
				},
			},
			map[string]any{"type": "response", "id": command.ID, "command": "prompt", "success": true},
		} {
			data, _ := json.Marshal(event)
			_, _ = fmt.Fprintln(writer, string(data))
			_ = writer.Flush()
		}
	}
	os.Exit(0)
}

func TestValidPromptBounds(t *testing.T) {
	if validPrompt(" ") {
		t.Fatal("blank prompt should be rejected")
	}
	if !validPrompt("hello") {
		t.Fatal("non-empty prompt should be accepted")
	}
	if validPrompt(strings.Repeat("x", 64*1024+1)) {
		t.Fatal("oversized prompt should be rejected")
	}
}

func TestLoadConfigRequiresTokenForNonLoopback(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PI_GO_POC_ROOT", root)
	t.Setenv("PI_WEB_ALLOWED_ROOTS", root)
	t.Setenv("PI_GO_DEFAULT_CWD", root)
	t.Setenv("PI_GO_BIND_HOST", "external.example.invalid")
	t.Setenv("PI_GO_PORT", "30142")
	t.Setenv("PI_WEB_ACCESS_TOKEN", "")

	if _, err := LoadConfig(); err == nil {
		t.Fatal("expected non-loopback listener without token to be rejected")
	}

	t.Setenv("PI_WEB_ACCESS_TOKEN", "test-token")
	if _, err := LoadConfig(); err != nil {
		t.Fatalf("expected configured token to allow non-loopback listener: %v", err)
	}
}
