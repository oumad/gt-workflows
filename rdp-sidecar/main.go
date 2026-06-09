// rdp-sidecar — tiny HTTP bridge that mirrors api/src/services/rdp.ts's
// embedded mode in a dedicated container.
//
// One endpoint: POST /rdp { host, username, domain?, password, holdSeconds? }
// Behavior:
//   1. Allocate a unique X display (counter starting at :100, wrapping at :999).
//   2. Start Xvfb on that display.
//   3. Start xfreerdp pointing at the host with the credential.
//   4. Hold for holdSeconds, then SIGTERM xfreerdp + Xvfb. Capture the tail of
//      xfreerdp's stderr.
//   5. Return JSON { ok, exitCode, signal, durationMs, stderrTail }.
//
// Auth: when RDP_BRIDGE_TOKEN is set, requests must carry an
//   `Authorization: Bearer <token>` header (constant-time compared). When
//   unset, any caller can hit the endpoint — only safe on a fully-private net.
//
// Stdlib-only on purpose: no go.mod deps, fast cold build, ~6 MB static binary.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

const (
	xvfbBootDelay    = 600 * time.Millisecond
	killWaitDelay    = 1 * time.Second
	stderrTailBytes  = 8 * 1024
	defaultHoldSecs  = 15
	maxHoldSecs      = 120
	defaultPort      = "8080"
	displayStart     = 100
	displayMax       = 999
)

var displayCounter atomic.Uint32

func init() {
	displayCounter.Store(displayStart)
}

// Atomic display allocation — wraps at displayMax so a long-lived process
// can't drift into kernel-reserved numbers.
func allocDisplay() int {
	for {
		v := displayCounter.Load()
		next := v + 1
		if next > displayMax {
			next = displayStart
		}
		if displayCounter.CompareAndSwap(v, next) {
			return int(v)
		}
	}
}

type rdpRequest struct {
	Host        string `json:"host"`
	Username    string `json:"username"`
	Domain      string `json:"domain"`
	Password    string `json:"password"`
	HoldSeconds int    `json:"holdSeconds"`
}

type rdpResponse struct {
	OK         bool   `json:"ok"`
	ExitCode   *int   `json:"exitCode"`
	Signal     string `json:"signal,omitempty"`
	DurationMs int64  `json:"durationMs"`
	StderrTail string `json:"stderrTail"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	token := os.Getenv("RDP_BRIDGE_TOKEN")
	if token == "" {
		log.Println("[rdp-sidecar] WARNING: RDP_BRIDGE_TOKEN is empty — endpoint is unauthenticated. Only run this on a fully-private network.")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/rdp", handleRDP(token))

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// No write timeout: a single /rdp call can legitimately hold for
		// holdSeconds + Xvfb boot + teardown (~17s default; capped via
		// maxHoldSecs). Connection idle time is bounded by the client.
	}

	log.Printf("[rdp-sidecar] listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("[rdp-sidecar] server error: %v", err)
	}
}

func handleRDP(expectedToken string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if expectedToken != "" {
			got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			// Constant-time compare so we don't leak the token via timing.
			if subtle.ConstantTimeCompare([]byte(got), []byte(expectedToken)) != 1 {
				writeError(w, http.StatusUnauthorized, "invalid or missing bearer token")
				return
			}
		}

		var req rdpRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json body")
			return
		}
		if req.Host == "" || req.Username == "" || req.Password == "" {
			writeError(w, http.StatusBadRequest, "host, username and password are required")
			return
		}
		hold := req.HoldSeconds
		if hold <= 0 {
			hold = defaultHoldSecs
		}
		if hold > maxHoldSecs {
			hold = maxHoldSecs
		}

		resp, err := runRDP(r.Context(), req, hold)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// runRDP mirrors the embedded dance in api/src/services/rdp.ts:
// Xvfb -> xfreerdp -> hold -> SIGTERM both -> return the result.
func runRDP(parent context.Context, req rdpRequest, holdSecs int) (*rdpResponse, error) {
	display := fmt.Sprintf(":%d", allocDisplay())
	start := time.Now()

	// 1. Start Xvfb on the unique display.
	xvfb := exec.Command(
		"Xvfb",
		display, "-screen", "0", "1280x800x24", "-nolisten", "tcp",
	)
	xvfb.Stdout = io.Discard
	xvfb.Stderr = io.Discard
	if err := xvfb.Start(); err != nil {
		return nil, fmt.Errorf("Xvfb failed to start: %w", err)
	}
	// Best-effort teardown on exit / panic.
	defer killAndForget(xvfb)

	// Give Xvfb a moment to come up. xfreerdp will retry once on a missing
	// display, but this is more reliable + matches the script's `sleep 1`.
	time.Sleep(xvfbBootDelay)

	// 2. Build xfreerdp args. /p:<password> appears in `ps` — acceptable
	//    inside the container (no other processes to spy on us); avoid
	//    logging the full arg list elsewhere.
	args := []string{
		"/v:" + req.Host,
		"/u:" + req.Username,
	}
	if req.Domain != "" {
		args = append(args, "/d:"+req.Domain)
	}
	args = append(args,
		"/p:"+req.Password,
		"/cert:ignore",
		"/w:1280", "/h:800",
		"-wallpaper", "-themes", "+clipboard",
		"/log-level:WARN",
	)
	xfreerdp := exec.Command("xfreerdp", args...)
	xfreerdp.Env = append(os.Environ(), "DISPLAY="+display)
	xfreerdp.Stdout = io.Discard
	stderrPipe, err := xfreerdp.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("xfreerdp stderr pipe: %w", err)
	}
	if err := xfreerdp.Start(); err != nil {
		return nil, fmt.Errorf("xfreerdp failed to start: %w", err)
	}

	// 3. Capture the tail of stderr (bounded by stderrTailBytes) concurrently
	//    with the hold timer.
	tailCh := make(chan []byte, 1)
	go func() {
		buf := make([]byte, 0, stderrTailBytes)
		tmp := make([]byte, 1024)
		for {
			n, rerr := stderrPipe.Read(tmp)
			if n > 0 {
				buf = append(buf, tmp[:n]...)
				if len(buf) > stderrTailBytes {
					buf = buf[len(buf)-stderrTailBytes:]
				}
			}
			if rerr != nil {
				break
			}
		}
		tailCh <- buf
	}()

	// 4. Wait for xfreerdp to exit OR the hold timer to fire.
	done := make(chan error, 1)
	go func() { done <- xfreerdp.Wait() }()

	holdTimer := time.NewTimer(time.Duration(holdSecs) * time.Second)
	defer holdTimer.Stop()

	timedOut := false
	var waitErr error
	select {
	case waitErr = <-done:
		// xfreerdp exited on its own (handshake failure, server hang up, etc.)
	case <-holdTimer.C:
		timedOut = true
		_ = xfreerdp.Process.Signal(syscall.SIGTERM)
		// Give it a moment, then escalate.
		select {
		case waitErr = <-done:
		case <-time.After(killWaitDelay):
			_ = xfreerdp.Process.Signal(syscall.SIGKILL)
			waitErr = <-done
		}
	case <-parent.Done():
		// Caller bailed (e.g. shutdown). Same SIGTERM→SIGKILL escalation as
		// the hold-timer path so a stuck xfreerdp can't keep the request
		// goroutine pinned forever.
		_ = xfreerdp.Process.Signal(syscall.SIGTERM)
		select {
		case waitErr = <-done:
		case <-time.After(killWaitDelay):
			_ = xfreerdp.Process.Signal(syscall.SIGKILL)
			waitErr = <-done
		}
	}

	// 5. Collect results.
	stderrTail := <-tailCh

	exitCode, signalName := classifyExit(waitErr, xfreerdp)
	ok := timedOut ||
		(exitCode != nil && *exitCode == 0) ||
		signalName == "SIGTERM" ||
		signalName == "SIGKILL"

	return &rdpResponse{
		OK:         ok,
		ExitCode:   exitCode,
		Signal:     signalName,
		DurationMs: time.Since(start).Milliseconds(),
		StderrTail: string(stderrTail),
	}, nil
}

// classifyExit converts the wait result into (exitCode, signalName), matching
// the shape the api/src/services/rdp.ts return type expects.
func classifyExit(waitErr error, cmd *exec.Cmd) (*int, string) {
	if cmd.ProcessState == nil {
		return nil, ""
	}
	status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if !ok {
		// Best-effort fallback — exit code only.
		c := cmd.ProcessState.ExitCode()
		if c == -1 {
			return nil, ""
		}
		return &c, ""
	}
	if status.Signaled() {
		// Killed by a signal — exit code is undefined. Map to the symbolic
		// name the api expects (rdp.ts checks for 'SIGTERM' / 'SIGKILL').
		return nil, signalName(status.Signal())
	}
	c := status.ExitStatus()
	return &c, ""
}

// signalName converts a syscall.Signal into the symbolic name the api wire
// contract uses. Go's Signal.String() returns descriptive labels like
// "terminated" / "killed" which would silently break the ok-classification
// in rdp.ts. Only the signals we actually deliver are mapped; anything else
// falls through to the raw "signal N" form for diagnostics.
func signalName(s syscall.Signal) string {
	switch s {
	case syscall.SIGTERM:
		return "SIGTERM"
	case syscall.SIGKILL:
		return "SIGKILL"
	case syscall.SIGINT:
		return "SIGINT"
	case syscall.SIGHUP:
		return "SIGHUP"
	case syscall.SIGPIPE:
		return "SIGPIPE"
	case syscall.SIGSEGV:
		return "SIGSEGV"
	}
	return fmt.Sprintf("signal %d", int(s))
}

func killAndForget(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		return
	}
	_ = cmd.Process.Signal(syscall.SIGTERM)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorResponse{Error: msg})
}
