package poc

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Address      string
	AccessToken  string
	ProjectRoot  string
	AllowedRoots []string
	DefaultCWD   string
	PiCommand    string
	NodeCommand  string
}

func LoadConfig() (Config, error) {
	workDir, err := os.Getwd()
	if err != nil {
		return Config{}, errors.New("cannot determine working directory")
	}

	projectRoot := strings.TrimSpace(os.Getenv("PI_GO_POC_ROOT"))
	if projectRoot == "" {
		projectRoot = findProjectRoot(workDir)
	}
	projectRoot, err = canonicalDirectory(projectRoot)
	if err != nil {
		return Config{}, errors.New("invalid Go prototype root")
	}

	roots := filepath.SplitList(strings.TrimSpace(os.Getenv("PI_WEB_ALLOWED_ROOTS")))
	if len(roots) == 0 || (len(roots) == 1 && roots[0] == "") {
		roots = []string{projectRoot}
	}
	allowedRoots := make([]string, 0, len(roots))
	for _, root := range roots {
		if strings.TrimSpace(root) == "" {
			continue
		}
		canonical, err := canonicalDirectory(root)
		if err != nil {
			return Config{}, errors.New("an allowed workspace root is not an accessible directory")
		}
		allowedRoots = append(allowedRoots, canonical)
	}
	if len(allowedRoots) == 0 {
		return Config{}, fmt.Errorf("no allowed workspace roots are configured")
	}

	defaultCWD := strings.TrimSpace(os.Getenv("PI_GO_DEFAULT_CWD"))
	if defaultCWD == "" {
		defaultCWD = allowedRoots[0]
	}
	defaultCWD, err = resolveWorkspace(defaultCWD, allowedRoots)
	if err != nil {
		return Config{}, errors.New("default workspace is not within an allowed root")
	}

	host := strings.TrimSpace(os.Getenv("PI_GO_BIND_HOST"))
	if host == "" {
		host = "localhost"
	}
	host = strings.Trim(host, "[]")
	port := strings.TrimSpace(os.Getenv("PI_GO_PORT"))
	if port == "" {
		port = "30142"
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return Config{}, errors.New("PI_GO_PORT must be between 1 and 65535")
	}

	token := os.Getenv("PI_WEB_ACCESS_TOKEN")
	if !isLoopbackHost(host) && strings.TrimSpace(token) == "" {
		return Config{}, errors.New("PI_WEB_ACCESS_TOKEN is required for non-loopback listeners")
	}

	return Config{
		Address:      net.JoinHostPort(host, port),
		AccessToken:  token,
		ProjectRoot:  projectRoot,
		AllowedRoots: allowedRoots,
		DefaultCWD:   defaultCWD,
		PiCommand:    strings.TrimSpace(os.Getenv("PI_RPC_COMMAND")),
		NodeCommand:  strings.TrimSpace(os.Getenv("PI_RPC_NODE")),
	}, nil
}

func findProjectRoot(start string) string {
	current, err := filepath.Abs(start)
	if err != nil {
		return start
	}
	for {
		if _, err := os.Stat(filepath.Join(current, "package.json")); err == nil {
			return current
		}
		parent := filepath.Dir(current)
		if parent == current {
			return start
		}
		current = parent
	}
}

func canonicalDirectory(candidate string) (string, error) {
	absolute, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() {
		return "", errors.New("not a directory")
	}
	return filepath.Clean(resolved), nil
}

func resolveWorkspace(candidate string, roots []string) (string, error) {
	if strings.TrimSpace(candidate) == "" {
		return "", errors.New("workspace is required")
	}
	resolved, err := canonicalDirectory(candidate)
	if err != nil {
		return "", err
	}
	for _, root := range roots {
		relative, err := filepath.Rel(root, resolved)
		if err != nil {
			continue
		}
		if relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))) {
			return resolved, nil
		}
	}
	return "", errors.New("workspace is outside allowed roots")
}

func isLoopbackHost(host string) bool {
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
