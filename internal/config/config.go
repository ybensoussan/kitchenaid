package config

import "os"

type Config struct {
	Port       string
	DBPath     string
	UploadsDir string
}

func Load() Config {
	c := Config{
		Port:       getEnv("PORT", "8080"),
		DBPath:     getEnv("DB_PATH", "./kitchenaid.db"),
		UploadsDir: getEnv("UPLOADS_DIR", "./uploads"),
	}
	return c
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
