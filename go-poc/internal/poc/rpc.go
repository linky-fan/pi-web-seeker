package poc

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	maxSessions          = 32
	maxEventHistory      = 256
	maxEventHistoryBytes = 1 << 20
	liveEventBuffer      = 8
	maxRPCLineBytes      = 1 << 20
)

type PiLauncher struct {
	Executable string
	Args       []string
}

type Manager struct {
	mu          sync.Mutex
	sessions    map[string]*Session
	inFlight    int
	closed      bool
	launcher    PiLauncher
	launchError error
}

type Session struct {
	ID string

	mu           sync.Mutex
	writeMu      sync.Mutex
	stdin        io.WriteCloser
	cancel       context.CancelFunc
	closed       bool
	nextEvent    uint64
	nextCmd      uint64
	history      []Event
	historyBytes int
	subs         map[chan Event]struct{}
	done         chan struct{}
	stopOnce     sync.Once
}

type Event struct {
	ID   uint64
	Data json.RawMessage
}

type promptCommand struct {
	ID      uint64 `json:"id"`
	Type    string `json:"type"`
	Message string `json:"message"`
}

func NewManager(cfg Config) *Manager {
	launcher, err := resolvePiLauncher(cfg)
	return &Manager{
		sessions:    make(map[string]*Session),
		launcher:    launcher,
		launchError: err,
	}
}

func resolvePiLauncher(cfg Config) (PiLauncher, error) {
	rpcArgs := []string{"--mode", "rpc", "--no-session"}
	if cfg.PiCommand != "" {
		if isShellScriptShim(cfg.PiCommand) {
			return PiLauncher{}, errors.New("PI_RPC_COMMAND must be an executable, not a .cmd or .bat shim")
		}
		executable, err := exec.LookPath(cfg.PiCommand)
		if err != nil {
			return PiLauncher{}, errors.New("configured Pi RPC executable was not found")
		}
		return PiLauncher{Executable: executable, Args: rpcArgs}, nil
	}

	if executable, err := exec.LookPath("pi"); err == nil && !isShellScriptShim(executable) {
		return PiLauncher{Executable: executable, Args: rpcArgs}, nil
	}

	entry := filepath.Join(cfg.ProjectRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js")
	if info, err := os.Stat(entry); err == nil && !info.IsDir() {
		node := cfg.NodeCommand
		if node == "" {
			node = "node"
		}
		executable, err := exec.LookPath(node)
		if err == nil {
			args := append([]string{entry}, rpcArgs...)
			return PiLauncher{Executable: executable, Args: args}, nil
		}
	}

	return PiLauncher{}, errors.New("Pi CLI is unavailable; install the project npm dependencies or set PI_RPC_COMMAND")
}

func isShellScriptShim(executable string) bool {
	extension := strings.ToLower(filepath.Ext(executable))
	return extension == ".cmd" || extension == ".bat"
}

func (m *Manager) Create(cwd string) (*Session, error) {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil, errors.New("session manager is closed")
	}
	if len(m.sessions)+m.inFlight >= maxSessions {
		m.mu.Unlock()
		return nil, errors.New("session limit reached")
	}
	if m.launchError != nil {
		err := m.launchError
		m.mu.Unlock()
		return nil, err
	}
	m.inFlight++
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		m.inFlight--
		m.mu.Unlock()
	}()

	id, err := newSessionID()
	if err != nil {
		return nil, errors.New("could not allocate session")
	}
	session, stdout, err := startSession(id, cwd, m.launcher)
	if err != nil {
		return nil, errors.New("could not start Pi RPC process")
	}

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		go session.readLoop(stdout)
		session.stop()
		return nil, errors.New("session manager is closed")
	}
	m.sessions[id] = session
	m.mu.Unlock()

	go session.readLoop(stdout)
	session.publishJSON(map[string]any{"type": "session_started", "sessionId": id})
	return session, nil
}

func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	return session, ok
}

func (m *Manager) Remove(id string) bool {
	m.mu.Lock()
	session, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if ok {
		session.stop()
	}
	return ok
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	m.closed = true
	sessions := make([]*Session, 0, len(m.sessions))
	for id, session := range m.sessions {
		delete(m.sessions, id)
		sessions = append(sessions, session)
	}
	m.mu.Unlock()
	for _, session := range sessions {
		session.requestStop()
	}
	for _, session := range sessions {
		session.waitForExit()
	}
}

func startSession(id, cwd string, launcher PiLauncher) (*Session, *waitReadCloser, error) {
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, launcher.Executable, launcher.Args...)
	cmd.Dir = cwd
	cmd.Stderr = io.Discard

	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		cancel()
		return nil, nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		cancel()
		return nil, nil, err
	}

	session := &Session{
		ID:     id,
		stdin:  stdin,
		cancel: cancel,
		subs:   make(map[chan Event]struct{}),
		done:   make(chan struct{}),
	}
	return session, &waitReadCloser{ReadCloser: stdout, cmd: cmd}, nil
}

type waitReadCloser struct {
	io.ReadCloser
	cmd *exec.Cmd
}

func (w *waitReadCloser) Wait() error {
	return w.cmd.Wait()
}

func (s *Session) readLoop(stdout *waitReadCloser) {
	defer close(s.done)
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), maxRPCLineBytes)
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		if !json.Valid(line) {
			s.publishJSON(map[string]any{"type": "protocol_error", "message": "Pi emitted a non-JSON RPC line"})
			continue
		}
		s.publish(line)
	}
	if scanner.Err() != nil {
		s.publishJSON(map[string]any{"type": "protocol_error", "message": "Pi RPC output exceeded the line limit or could not be read"})
		s.cancel()
	}

	waitErr := stdout.Wait()
	exit := map[string]any{"type": "process_exit", "success": waitErr == nil}
	s.publishJSON(exit)
	s.closeSubscribers()
}

func (s *Session) SendPrompt(message string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.Lock()
	closed := s.closed
	s.nextCmd++
	commandID := s.nextCmd
	s.mu.Unlock()
	if closed {
		return errors.New("session is closed")
	}

	payload, err := json.Marshal(promptCommand{
		ID:      commandID,
		Type:    "prompt",
		Message: message,
	})
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	if _, err := s.stdin.Write(payload); err != nil {
		return errors.New("could not send prompt to Pi")
	}
	return nil
}

func (s *Session) stop() {
	s.requestStop()
	s.waitForExit()
}

func (s *Session) requestStop() {
	s.stopOnce.Do(func() {
		s.cancel()
		_ = s.stdin.Close()
	})
}

func (s *Session) waitForExit() {
	s.mu.Lock()
	done := s.done
	s.mu.Unlock()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
	}
}

func (s *Session) publishJSON(value any) {
	data, err := json.Marshal(value)
	if err == nil {
		s.publish(data)
	}
}

func (s *Session) publish(data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.nextEvent++
	event := Event{ID: s.nextEvent, Data: append(json.RawMessage(nil), data...)}
	s.history = append(s.history, event)
	s.historyBytes += len(event.Data)
	for len(s.history) > maxEventHistory || s.historyBytes > maxEventHistoryBytes {
		s.historyBytes -= len(s.history[0].Data)
		s.history = s.history[1:]
	}
	for subscriber := range s.subs {
		select {
		case subscriber <- event:
		default:
			close(subscriber)
			delete(s.subs, subscriber)
		}
	}
}

func (s *Session) subscribe(after uint64) ([]Event, <-chan Event, func(), bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	replay := make([]Event, 0, len(s.history))
	for _, event := range s.history {
		if event.ID > after {
			replay = append(replay, event)
		}
	}
	truncated := len(s.history) > 0 && after > 0 && after < s.history[0].ID && s.history[0].ID-after > 1
	channel := make(chan Event, liveEventBuffer)
	if s.closed {
		close(channel)
		return replay, channel, func() {}, truncated
	}
	s.subs[channel] = struct{}{}
	cancel := func() {
		s.mu.Lock()
		if _, ok := s.subs[channel]; ok {
			delete(s.subs, channel)
			close(channel)
		}
		s.mu.Unlock()
	}
	return replay, channel, cancel, truncated
}

func (s *Session) closeSubscribers() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	for subscriber := range s.subs {
		close(subscriber)
		delete(s.subs, subscriber)
	}
}

func newSessionID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

func validPrompt(message string) bool {
	return strings.TrimSpace(message) != "" && len(message) <= 64*1024
}
