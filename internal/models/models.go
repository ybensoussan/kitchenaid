package models

import "time"

type Recipe struct {
	ID           int64     `json:"id"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	ImageURL     string    `json:"image_url"`
	PrepTime     int       `json:"prep_time"`
	CookTime     int       `json:"cook_time"`
	BaseServings int       `json:"base_servings"`
	SourceURL    string    `json:"source_url"`
	Favorited    bool      `json:"favorited"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Ingredients  []Ingredient `json:"ingredients,omitempty"`
	Steps        []Step       `json:"steps,omitempty"`
	Tags         []string     `json:"tags,omitempty"`
}

type TagSuggestionResponse struct {
	Tags []string `json:"tags"`
}

type Ingredient struct {
	ID            int64   `json:"id"`
	RecipeID      int64   `json:"recipe_id"`
	SortOrder     int     `json:"sort_order"`
	Name          string  `json:"name"`
	Amount        float64 `json:"amount"`
	Unit          string  `json:"unit"`
	Notes         string  `json:"notes"`
	PantryItemID  *int64  `json:"pantry_item_id"`
}

type Step struct {
	ID          int64  `json:"id"`
	RecipeID    int64  `json:"recipe_id"`
	StepNumber  int    `json:"step_number"`
	Instruction string `json:"instruction"`
	Duration    int    `json:"duration"`
}

// Request/response types

type CreateRecipeRequest struct {
	Title        string       `json:"title"`
	Description  string       `json:"description"`
	ImageURL     string       `json:"image_url"`
	PrepTime     int          `json:"prep_time"`
	CookTime     int          `json:"cook_time"`
	BaseServings int          `json:"base_servings"`
	SourceURL    string       `json:"source_url"`
	Ingredients  []IngredientInput `json:"ingredients"`
	Steps        []StepInput       `json:"steps"`
}

type IngredientInput struct {
	SortOrder    int     `json:"sort_order"`
	Name         string  `json:"name"`
	Amount       float64 `json:"amount"`
	Unit         string  `json:"unit"`
	Notes        string  `json:"notes"`
	PantryItemID *int64  `json:"pantry_item_id"`
}

type LinkIngredientPantryRequest struct {
	PantryItemID *int64 `json:"pantry_item_id"`
}

type StepInput struct {
	StepNumber  int    `json:"step_number"`
	Instruction string `json:"instruction"`
	Duration    int    `json:"duration"`
}

type PatchRequest struct {
	Field string      `json:"field"`
	Value interface{} `json:"value"`
}

type ReorderRequest struct {
	IDs []int64 `json:"ids"`
}

type ImportURLRequest struct {
	URL string `json:"url"`
}

type ImportHTMLRequest struct {
	HTML      string `json:"html"`
	SourceURL string `json:"source_url"`
}

type PantryItem struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	Price         float64   `json:"price"`
	PriceUnitSize string    `json:"price_unit_size"`
	ImageURL      string    `json:"image_url"`
	CreatedAt     time.Time `json:"created_at"`
}

type PantryItemInput struct {
	Name          string  `json:"name"`
	Price         float64 `json:"price"`
	PriceUnitSize string  `json:"price_unit_size"`
	ImageURL      string  `json:"image_url"`
}

type UnlinkedIngredient struct {
	ID          int64   `json:"id"`
	RecipeID    int64   `json:"recipe_id"`
	RecipeTitle string  `json:"recipe_title"`
	Name        string  `json:"name"`
	Amount      float64 `json:"amount"`
	Unit        string  `json:"unit"`
}

type UploadResponse struct {
	URL string `json:"url"`
}

type Settings struct {
	AIProvider      string       `json:"ai_provider"` // "anthropic" or "gemini"
	AnthropicAPIKey string       `json:"anthropic_api_key"`
	GeminiAPIKey    string       `json:"gemini_api_key"`
	Model           string       `json:"model"`
	Auth            AuthSettings `json:"auth"`
}

type AuthSettings struct {
	Enabled               bool   `json:"enabled"`
	GoogleClientID        string `json:"google_client_id"`
	GoogleClientSecret    string `json:"google_client_secret"`
	MicrosoftClientID     string `json:"microsoft_client_id"`
	MicrosoftClientSecret string `json:"microsoft_client_secret"`
	FacebookClientID      string `json:"facebook_client_id"`
	FacebookClientSecret  string `json:"facebook_client_secret"`
}

type AuthConfig struct {
	Enabled   bool     `json:"enabled"`
	Providers []string `json:"providers"`
	HasUsers  bool     `json:"has_users"`
}

type User struct {
	ID            int64     `json:"id"`
	Email         string    `json:"email"`
	DisplayName   string    `json:"display_name"`
	PasswordHash  *string   `json:"-"`
	OAuthProvider string    `json:"oauth_provider,omitempty"`
	OAuthID       string    `json:"-"`
	CreatedAt     time.Time `json:"created_at"`
}

type Session struct {
	Token     string    `json:"-"`
	UserID    int64     `json:"user_id"`
	UserEmail string    `json:"email"`
	UserName  string    `json:"display_name"`
	ExpiresAt time.Time `json:"-"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	Password    string `json:"password"`
}

type APIResponse struct {
	Data  interface{} `json:"data"`
	Error *string     `json:"error"`
}

// Meal Planner

type MealPlan struct {
	ID        int64           `json:"id"`
	Name      string          `json:"name"`
	WeekStart string          `json:"week_start"` // YYYY-MM-DD of Monday
	Entries   []MealPlanEntry `json:"entries"`
	CreatedAt string          `json:"created_at"`
}

type MealPlanEntry struct {
	ID          int64  `json:"id"`
	MealPlanID  int64  `json:"meal_plan_id"`
	RecipeID    int64  `json:"recipe_id"`
	RecipeTitle string `json:"recipe_title"`
	RecipeImage string `json:"recipe_image"`
	Day         string `json:"day"`       // monday..sunday
	MealType    string `json:"meal_type"` // breakfast, lunch, dinner, snack
	Servings    int    `json:"servings"`
}

type GroceryItem struct {
	Name     string   `json:"name"`
	Amount   float64  `json:"amount"`
	Unit     string   `json:"unit"`
	Recipes  []string `json:"recipes"`
	ImageURL string   `json:"image_url"`
}
