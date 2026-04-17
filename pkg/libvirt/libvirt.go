// Package libvirt is a thin wrapper around github.com/digitalocean/go-libvirt.
//
// go-libvirt speaks libvirt's RPC protocol directly over the UNIX socket,
// so we avoid the cgo-heavy official bindings. Works against a standard
// Ubuntu libvirt-daemon-system installation — the socket lives at
// /var/run/libvirt/libvirt-sock, owned by root:libvirt (mode 0770).
//
// This package only exposes the subset of libvirt operations staxv needs.
// Every exported type/method is written to survive "libvirtd restarted"
// by returning a clear error — the caller (typically a handler) maps
// that to 503 Service Unavailable and the admin restarts staxv.
//
// Long-term plan: add auto-reconnect with jitter/backoff. YAGNI until we
// see real libvirt restarts in production.
package libvirt

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sync"
	"time"

	golibvirt "github.com/digitalocean/go-libvirt"
)

// DefaultURI is the libvirt URI staxv uses unless overridden in config.
// Matches Ubuntu's libvirt-daemon-system default socket path.
const DefaultURI = "unix:///var/run/libvirt/libvirt-sock"

// dialTimeout bounds how long Connect blocks on socket establishment.
const dialTimeout = 5 * time.Second

// Client wraps a go-libvirt *Libvirt and adds a mutex so concurrent HTTP
// handlers can share one connection. go-libvirt's wire protocol is safe
// for concurrent reads, but we serialize at the wrapper level to make
// error-handling simpler — if one request sees a broken connection, it
// marks the client dead and subsequent calls fail cleanly.
type Client struct {
	uri string

	mu     sync.Mutex
	conn   net.Conn
	lv     *golibvirt.Libvirt
	closed bool
}

// New establishes a connection to libvirt at uri. Pass DefaultURI for
// the standard local socket. Currently only unix:// schemes are
// supported — remote tcp:// libvirt needs TLS auth which we haven't
// wired up.
func New(ctx context.Context, uri string) (*Client, error) {
	if uri == "" {
		uri = DefaultURI
	}
	u, err := url.Parse(uri)
	if err != nil {
		return nil, fmt.Errorf("libvirt: parse uri %q: %w", uri, err)
	}
	if u.Scheme != "unix" {
		return nil, fmt.Errorf("libvirt: unsupported scheme %q (only unix:// for now)", u.Scheme)
	}

	d := &net.Dialer{Timeout: dialTimeout}
	conn, err := d.DialContext(ctx, "unix", u.Path)
	if err != nil {
		return nil, fmt.Errorf("libvirt: dial %s: %w", u.Path, err)
	}

	lv := golibvirt.New(conn)
	if err := lv.ConnectToURI(golibvirt.QEMUSystem); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("libvirt: handshake: %w", err)
	}

	return &Client{uri: uri, conn: conn, lv: lv}, nil
}

// URI returns the libvirt URI the client was configured with.
func (c *Client) URI() string { return c.uri }

// Close tears down the connection. Safe to call more than once.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	_ = c.lv.Disconnect()
	return c.conn.Close()
}

// libvirt returns the underlying go-libvirt client with the mutex held.
// Callers must call Unlock() themselves — keeps the lock narrow by
// making the coupling explicit.
func (c *Client) libvirt() (*golibvirt.Libvirt, error) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, errors.New("libvirt: client closed")
	}
	return c.lv, nil
}

// Unlock releases the client mutex. Pair with every libvirt() call.
func (c *Client) Unlock() { c.mu.Unlock() }
