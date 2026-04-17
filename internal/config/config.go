// Package config loads the TOML config file.
//
// Kept deliberately small — no viper, no env-var sprawl. Anything that
// needs env overrides for deploy-time secrets can be added here one key
// at a time.
package config

import (
	"fmt"
	"os"
	"time"

	"github.com/BurntSushi/toml"
)

// Config is the top-level parsed TOML. Zero values are safe defaults
// for dev use; production should provide values explicitly.
type Config struct {
	Server struct {
		Addr   string `toml:"addr"`    // e.g. ":5001"
		Secure bool   `toml:"secure"`  // behind TLS? sets cookie Secure flag
	} `toml:"server"`

	Log struct {
		Level string `toml:"level"` // debug | info | warn | error
	} `toml:"log"`

	DB struct {
		Path string `toml:"path"` // e.g. "./tmp/staxv.db"
	} `toml:"db"`

	Auth struct {
		SecretPath string        `toml:"secret_path"` // file holding 32-byte HS256 secret
		TTL        time.Duration `toml:"ttl"`         // session lifetime, e.g. "24h"
	} `toml:"auth"`

	Host struct {
		QemuUser  string `toml:"qemu_user"`  // default "libvirt-qemu" (Ubuntu)
		QemuGroup string `toml:"qemu_group"` // default "kvm" (Ubuntu)
	} `toml:"host"`
}

// Load reads path and returns the parsed config with defaults filled in.
func Load(path string) (*Config, error) {
	cfg := &Config{}
	cfg.applyDefaults()

	if path != "" {
		if _, err := os.Stat(path); err == nil {
			if _, err := toml.DecodeFile(path, cfg); err != nil {
				return nil, fmt.Errorf("parse %s: %w", path, err)
			}
		} else if !os.IsNotExist(err) {
			return nil, fmt.Errorf("stat %s: %w", path, err)
		}
		// If the file doesn't exist we silently use defaults. Good for
		// first-run dev; for prod, operators should provide a config.
	}
	cfg.applyDefaults() // re-apply for any zero values the TOML left unset
	return cfg, nil
}

func (c *Config) applyDefaults() {
	if c.Server.Addr == "" {
		c.Server.Addr = ":5001"
	}
	if c.Log.Level == "" {
		c.Log.Level = "info"
	}
	if c.DB.Path == "" {
		c.DB.Path = "./tmp/staxv.db"
	}
	if c.Auth.SecretPath == "" {
		c.Auth.SecretPath = "./tmp/jwt.key"
	}
	if c.Auth.TTL == 0 {
		c.Auth.TTL = 24 * time.Hour
	}
	if c.Host.QemuUser == "" {
		c.Host.QemuUser = "libvirt-qemu"
	}
	if c.Host.QemuGroup == "" {
		c.Host.QemuGroup = "kvm"
	}
}
