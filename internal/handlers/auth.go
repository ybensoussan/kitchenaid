package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"kitchenaid/internal/auth"
	"kitchenaid/internal/db"
	"kitchenaid/internal/models"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"golang.org/x/oauth2/microsoft"
)

const sessionCookieName = "ka_session"
const stateCookieName = "ka_oauth_state"
const sessionDuration = 30 * 24 * time.Hour

func (h *Handler) GetAuthConfig(w http.ResponseWriter, r *http.Request) {
	settings, err := h.Store.GetSettings()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	cfg := models.AuthConfig{Enabled: settings.Auth.Enabled}
	if settings.Auth.GoogleClientID != "" {
		cfg.Providers = append(cfg.Providers, "google")
	}
	if settings.Auth.MicrosoftClientID != "" {
		cfg.Providers = append(cfg.Providers, "microsoft")
	}
	if settings.Auth.FacebookClientID != "" {
		cfg.Providers = append(cfg.Providers, "facebook")
	}
	if cfg.Providers == nil {
		cfg.Providers = []string{}
	}
	count, _ := h.Store.GetUserCount()
	cfg.HasUsers = count > 0
	h.writeJSON(w, http.StatusOK, cfg)
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	settings, err := h.Store.GetSettings()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var req models.RegisterRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		h.writeError(w, http.StatusBadRequest, "email and password required")
		return
	}

	// If auth is enabled, only allow registration when there are no users yet
	// (first-time setup), or from an authenticated admin
	if settings.Auth.Enabled {
		count, err := h.Store.GetUserCount()
		if err != nil {
			h.writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		_, isAuthed := r.Context().Value(auth.SessionKey).(models.Session)
		if count > 0 && !isAuthed {
			h.writeError(w, http.StatusForbidden, "registration is closed")
			return
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}
	hashStr := string(hash)

	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = req.Email
	}

	user, err := h.Store.CreateUser(models.User{
		Email:        req.Email,
		DisplayName:  displayName,
		PasswordHash: &hashStr,
	})
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			h.writeError(w, http.StatusConflict, "email already registered")
		} else {
			h.writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	if err := h.createSessionAndCookie(w, r, user.ID); err != nil {
		h.writeError(w, http.StatusInternalServerError, "session creation failed")
		return
	}

	user.PasswordHash = nil
	h.writeJSON(w, http.StatusCreated, user)
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	user, err := h.Store.GetUserByEmail(req.Email)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if user.PasswordHash == nil {
		h.writeError(w, http.StatusUnauthorized, "this account uses social login — use the OAuth button")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(req.Password)); err != nil {
		h.writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if err := h.createSessionAndCookie(w, r, user.ID); err != nil {
		h.writeError(w, http.StatusInternalServerError, "session creation failed")
		return
	}

	user.PasswordHash = nil
	h.writeJSON(w, http.StatusOK, user)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookieName); err == nil {
		_ = h.Store.DeleteSession(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "logged out"})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	sess, ok := r.Context().Value(auth.SessionKey).(models.Session)
	if !ok {
		h.writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"user_id":      sess.UserID,
		"email":        sess.UserEmail,
		"display_name": sess.UserName,
	})
}

func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.Store.ListUsers()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, users)
}

func (h *Handler) DeleteAuthUser(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	sess, ok := r.Context().Value(auth.SessionKey).(models.Session)
	if ok && sess.UserID == id {
		h.writeError(w, http.StatusBadRequest, "cannot delete your own account")
		return
	}
	if err := h.Store.DeleteUser(id); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ── OAuth2 ────────────────────────────────────────────────────────────────────

func (h *Handler) OAuthStart(w http.ResponseWriter, r *http.Request) {
	provider := r.URL.Query().Get("provider")
	cfg, err := h.buildOAuthConfig(provider, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	state, err := auth.GenerateToken()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     stateCookieName,
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	http.Redirect(w, r, cfg.AuthCodeURL(state, oauth2.AccessTypeOnline), http.StatusFound)
}

func (h *Handler) OAuthCallback(w http.ResponseWriter, r *http.Request) {
	provider := r.URL.Query().Get("provider")

	stateCookie, err := r.Cookie(stateCookieName)
	if err != nil || stateCookie.Value != r.URL.Query().Get("state") {
		http.Error(w, "invalid state parameter", http.StatusBadRequest)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: stateCookieName, Value: "", Path: "/", MaxAge: -1})

	cfg, err := h.buildOAuthConfig(provider, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	token, err := cfg.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		http.Error(w, "token exchange failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	oauthUser, err := h.fetchOAuthUserInfo(provider, token, cfg)
	if err != nil {
		http.Error(w, "failed to get user info: "+err.Error(), http.StatusInternalServerError)
		return
	}

	user, err := h.Store.GetUserByOAuthID(provider, oauthUser.id)
	if errors.Is(err, db.ErrNotFound) {
		user, err = h.Store.GetUserByEmail(oauthUser.email)
		if errors.Is(err, db.ErrNotFound) {
			user, err = h.Store.CreateUser(models.User{
				Email:         oauthUser.email,
				DisplayName:   oauthUser.name,
				OAuthProvider: provider,
				OAuthID:       oauthUser.id,
			})
		}
	}
	if err != nil {
		http.Error(w, "user error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := h.createSessionAndCookie(w, r, user.ID); err != nil {
		http.Error(w, "session error", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/", http.StatusFound)
}

type oauthUserInfo struct {
	id    string
	email string
	name  string
}

func (h *Handler) fetchOAuthUserInfo(provider string, token *oauth2.Token, cfg *oauth2.Config) (*oauthUserInfo, error) {
	client := cfg.Client(context.Background(), token)

	var url string
	switch provider {
	case "google":
		url = "https://www.googleapis.com/oauth2/v3/userinfo"
	case "microsoft":
		url = "https://graph.microsoft.com/v1.0/me"
	case "facebook":
		url = "https://graph.facebook.com/me?fields=id,name,email"
	default:
		return nil, fmt.Errorf("unknown provider: %s", provider)
	}

	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}

	info := &oauthUserInfo{}
	switch provider {
	case "google":
		info.id, _ = data["sub"].(string)
		info.email, _ = data["email"].(string)
		info.name, _ = data["name"].(string)
	case "microsoft":
		info.id, _ = data["id"].(string)
		info.email, _ = data["mail"].(string)
		if info.email == "" {
			info.email, _ = data["userPrincipalName"].(string)
		}
		info.name, _ = data["displayName"].(string)
	case "facebook":
		info.id, _ = data["id"].(string)
		info.email, _ = data["email"].(string)
		info.name, _ = data["name"].(string)
	}
	return info, nil
}

func (h *Handler) buildOAuthConfig(provider string, r *http.Request) (*oauth2.Config, error) {
	settings, err := h.Store.GetSettings()
	if err != nil {
		return nil, err
	}

	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	redirectURL := fmt.Sprintf("%s://%s/api/auth/oauth/callback?provider=%s", scheme, r.Host, provider)

	switch provider {
	case "google":
		if settings.Auth.GoogleClientID == "" {
			return nil, fmt.Errorf("google OAuth not configured")
		}
		return &oauth2.Config{
			ClientID:     settings.Auth.GoogleClientID,
			ClientSecret: settings.Auth.GoogleClientSecret,
			RedirectURL:  redirectURL,
			Scopes:       []string{"openid", "email", "profile"},
			Endpoint:     google.Endpoint,
		}, nil
	case "microsoft":
		if settings.Auth.MicrosoftClientID == "" {
			return nil, fmt.Errorf("microsoft OAuth not configured")
		}
		return &oauth2.Config{
			ClientID:     settings.Auth.MicrosoftClientID,
			ClientSecret: settings.Auth.MicrosoftClientSecret,
			RedirectURL:  redirectURL,
			Scopes:       []string{"openid", "email", "profile", "User.Read"},
			Endpoint:     microsoft.AzureADEndpoint("common"),
		}, nil
	case "facebook":
		if settings.Auth.FacebookClientID == "" {
			return nil, fmt.Errorf("facebook OAuth not configured")
		}
		return &oauth2.Config{
			ClientID:     settings.Auth.FacebookClientID,
			ClientSecret: settings.Auth.FacebookClientSecret,
			RedirectURL:  redirectURL,
			Scopes:       []string{"email", "public_profile"},
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://www.facebook.com/v18.0/dialog/oauth",
				TokenURL: "https://graph.facebook.com/v18.0/oauth/access_token",
			},
		}, nil
	default:
		return nil, fmt.Errorf("unknown provider: %s", provider)
	}
}

func (h *Handler) createSessionAndCookie(w http.ResponseWriter, r *http.Request, userID int64) error {
	token, err := auth.GenerateToken()
	if err != nil {
		return err
	}
	expiresAt := time.Now().Add(sessionDuration)
	if err := h.Store.CreateSession(userID, token, expiresAt); err != nil {
		return err
	}
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}
