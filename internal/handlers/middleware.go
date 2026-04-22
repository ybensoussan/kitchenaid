package handlers

import (
	"context"
	"encoding/json"
	"kitchenaid/internal/auth"
	"kitchenaid/internal/db"
	"kitchenaid/internal/models"
	"net/http"
	"strings"
)

func AuthMiddleware(store *db.Store, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		settings, err := store.GetSettings()
		if err != nil || !settings.Auth.Enabled {
			next.ServeHTTP(w, r)
			return
		}

		if isAuthPublicPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		cookie, err := r.Cookie(sessionCookieName)
		if err == nil {
			if sess, err := store.GetSession(cookie.Value); err == nil {
				ctx := context.WithValue(r.Context(), auth.SessionKey, sess)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
		}

		w.Header().Set("Cache-Control", "no-store")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			msg := "unauthorized"
			json.NewEncoder(w).Encode(models.APIResponse{Data: nil, Error: &msg})
		} else {
			http.Redirect(w, r, "/login.html", http.StatusFound)
		}
	})
}

// isAuthPublicPath returns true for paths that never require authentication.
func isAuthPublicPath(path string) bool {
	// Specific auth endpoints the login page needs
	switch path {
	case "/api/auth/config", "/api/auth/login", "/api/auth/logout", "/api/auth/register":
		return true
	}
	// OAuth flow
	if strings.HasPrefix(path, "/api/auth/oauth/") {
		return true
	}
	// Static assets needed by the login page
	for _, prefix := range []string{"/css/", "/js/", "/login.html", "/uploads/"} {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	// Image proxy
	if path == "/img" || strings.HasPrefix(path, "/img?") {
		return true
	}
	return false
}
