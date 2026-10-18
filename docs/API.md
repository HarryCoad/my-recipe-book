# My Recipe Book API

Base URL: `http://localhost:8000/api/v1` (the port comes from `PORT` in `config.env`).

## Basics

### Authentication

Signup and login return a JWT `token`. Send it on every other request as a header:

```
Authorization: Bearer <token>
```

Login also sets an `at` cookie, but the API doesn't read it. Only the header works.

### CORS

Only `http://localhost:3000` is allowed, with credentials. Change this in `app.ts` if the UI runs elsewhere.

### Rate limit

1000 requests per hour per IP across `/api`. After that every request gets a 429.

### IDs

Every `_id` in a response is renamed to `id`, including nested ones such as ingredients.

### Response shape

Success:

```json
{ "status": 1, "data": { ... } }
```

Error:

```json
{ "status": 0, "message": "ERROR_CODE" }
```

`message` is usually one of the [error codes](#error-codes) below, so the UI can map it to friendly text. Some older messages are plain English, for example `"Invalid token"`.

Request body validation failures (on create recipe, update recipe and edit recipe) return a 400 with the field details:

```json
{
  "status": 0,
  "message": "Validation_Error",
  "errors": [{ "fieldname": "ingredients.[0].unit", "code": "invalid_enum_value" }]
}
```

In development, error responses also include a `devOnly` field with the stack trace.

### Naming

Boolean fields start with `b`, for example `bPrivate` and `bSaved`. Booleans in query strings must be the string `true`. Anything else counts as false.

## Objects

### Recipe

Every recipe response, single or in a list, has this shape:

```ts
{
  id: string;
  authorId: string | null;     // null if the author deleted it (see "Recipes without an author")
  authorName: string | null;   // the author's username, null when authorId is null
  bPrivate: boolean;
  bAllowSuggestions: boolean;
  title: string;
  description: string | null;  // null for older recipes saved without one
  category: Category;
  serves: number;
  prepTime: number;            // minutes
  cookTime: number;            // minutes
  ingredients: {               // grouped by subheader, see below
    id: string;
    subheader: string | null;  // optional heading to group ingredients, e.g. "For the sauce"
    quantity: number;
    name: string;
    unit: Unit;
  }[];
  steps: string[];
  tags: string[];              // always normalised, see "Tags" below
  bSaved: boolean;             // whether the current user has saved it
  savedCount: number;          // how many users have saved it, including the author
  bDeleted: boolean;           // always false in responses
}
```

When the current user has made a [personal edit](#personal-edits), its `ingredients`, `steps` and `tags` replace the originals in every response, unless the request asks for the original.

Responses may also include `authorType`, an internal field the UI can ignore.

**Ingredient order:** in every response, recipes and edits alike, ingredients come back grouped by subheader. Ingredients without a subheader come first, then each subheader in the order it's first used, and the order within each group is kept. So the UI can show a heading each time `subheader` changes. Subheaders that differ only by spaces at either end count as the same, and an empty subheader counts as none. Ingredients are stored in the order they were sent, and only grouped in responses.

**Category** is one of: `Starter`, `Small Plate`, `Sharer`, `Main`, `Dessert`, `Breakfast`, `Lunch`, `Cocktail`, `Baking`.

**Unit** is one of: `g`, `kg`, `tsp`, `tbsp`, `ml`, `liter`, `pieces`, `cloves`, `small`, `medium`, `large`.

Both lists live in `constants/recipeConstants.ts`.

### Edit

Personal edits and suggestions are both stored as edits:

```ts
{
  id: string;
  recipeId: string;           // in /my-suggestions this is { id, title } instead
  userId: string;
  userName: string | null;    // username of who made it, null if their account was deleted
  isSuggestion: boolean;
  ingredients: Ingredient[];  // empty means "not changed"
  steps: string[];            // empty means "not changed"
  tags?: string[];            // missing means "not changed", [] means "remove all tags"
  comments?: string;
  status: 'pending' | 'accepted' | 'rejected';  // only meaningful for suggestions
}
```

### User

```ts
{ id: string; username: string; email: string; photo: string }
```

## How the features work

### Tags

Users create their own tags. Wherever tags are saved (recipes, personal edits, suggestions), the API cleans them up first:

- Spaces at either end are removed, and repeated spaces become one.
- Tags are lowercased, so `" Gluten  Free"` is stored as `"gluten free"`.
- Duplicates and empty tags are removed.

After that, each tag can be at most 30 characters, and a recipe can have at most 10 tags. Breaking either limit returns a `Validation_Error`.

To stop near-duplicates building up, the UI should offer autocomplete from [`GET /recipes/tags`](#get-recipestags) as the user types a tag. Display tags in whatever case suits the design. They're stored lowercase.

### Personal edits

A user who has saved someone else's recipe can change its ingredients, steps and tags for themselves only. The author and other users keep seeing the original.

- A user can have one personal edit per recipe. Editing again updates it. Fields left out of a request are left as they were.
- `GET /recipes/:id` returns `bHasEdits`, so the UI can offer "view original" (`?original=true`) and "reset" (`POST /recipes/reset-edit`).
- Unsaving a recipe deletes the user's personal edit. If they have one, the unsave is refused with `CONFIRM_LOSE_EDITS` until the request includes `bConfirmLoseEdits: true`. Show a warning, then resend.

### Suggestions

A user who has saved a recipe can suggest changes to the author, if the author allows it (`bAllowSuggestions`). The author accepts or rejects each one separately. Accepting applies the suggestion's ingredients, steps and tags to the recipe for everyone.

### Recipes without an author

When an author deletes a recipe (or their account):

- If nobody else has it saved, it's deleted.
- Otherwise it's kept for the people who saved it, with `authorId` and `authorName` set to `null`. Nobody can change it, suggestions are turned off and pending ones are removed. Savers keep their personal edits.
- It's hidden from general search but still appears in savers' saved lists (`?bOnlySaved=true`).
- Anyone with the link can still open it if it was public, so it can be shared. If it was private, only its savers can.
- It's deleted once the last saver unsaves it.

## Users endpoints

### `POST /users/signup`

No auth needed.

```json
{ "username": "alice", "email": "alice@example.com", "password": "password123", "passwordConfirm": "password123" }
```

- `username`: 4 to 40 characters, must be unique.
- `password`: at least 8 characters.

**201:** `{ status, token, data: { user: User } }`

**Errors:** `USERNAME_TAKEN`, `UNIQUE_EMAIL` and invalid fields, all 400.

### `POST /users/login`

No auth needed.

```json
{ "email": "alice@example.com", "password": "password123" }
```

**200:** `{ status, token, data: { user: User } }`

**Errors:** `MISSING_EMAIL_PASSWORD` (400), `INVALID_CREDENTIALS` (401).

### `POST /users/forgotten-password`

No auth needed. Body: `{ "email" }`. Emails the user a reset link containing a token.

**Errors:** 404 if no user has that email.

### `PATCH /users/reset-password/:token`

No auth needed. Body: `{ "password", "passwordConfirm" }`. Logs the user in, with the same response as login.

**Errors:** 400 if the token is invalid or expired.

### `GET /users/user-details`

**200:** `{ status, data: User }`. Saved recipes aren't included: use `GET /users/saved-recipes`.

### `PATCH /users/update-me`

Body: `{ "username" }`. Email can't be changed for now, and passwords use `/update-password`.

**200:** `{ status, data: { user: User } }`

**Errors:** `USERNAME_TAKEN`, and `INVALID_FIELDNAME` for any other field, both 400. Nothing is changed when the request is rejected.

### `PATCH /users/update-password`

Body: `{ "currentPassword", "password", "passwordConfirm" }`. Returns a new token, with the same response as login. Older tokens stop working.

**Errors:** `MISSING_FIELDS` (400), `INVALID_CURRENT_PASSWORD` (401).

### `DELETE /users/delete-account`

**204**, no body. Deactivates the account and stops its token working. Their recipes are handled as if they deleted each one (see [Recipes without an author](#recipes-without-an-author)). They're removed from everything they saved, and their personal edits and suggestions are deleted.

### `GET /users/saved-recipes`

Returns only the IDs of saved recipes, in the order the user saved them (oldest first). This includes recipes the user created, since authors have their own recipes saved. Saving a recipe that's already saved keeps its original `savedAt`. For a list to show in the UI, use `GET /recipes/search?bOnlySaved=true`.

**200:** `{ status, data: { recipeId: string, savedAt: string }[] }`

## Recipes endpoints

All of these need auth.

### `POST /recipes/create`

```json
{
  "title": "Pancakes",
  "description": "Fluffy pancakes",
  "category": "Breakfast",
  "serves": 2,
  "prepTime": 10,
  "cookTime": 15,
  "ingredients": [{ "quantity": 200, "name": "flour", "unit": "g", "subheader": null }],
  "steps": ["Mix", "Cook"],
  "tags": ["quick"],
  "bPrivate": false,
  "bAllowSuggestions": true
}
```

`tags`, `bPrivate` (default `false`), `bAllowSuggestions` (default `false`) and `subheader` are optional. `tags` are [normalised](#tags), with a limit of 10 tags of up to 30 characters each. `serves`, `prepTime`, `cookTime` and `quantity` must be positive. The author automatically saves their own recipe.

**200:** `{ status, data: { recipe: Recipe } }`

**Errors:** `Validation_Error` (400).

### `GET /recipes/search`

| Query param | Default | Notes |
|---|---|---|
| `search` | | Matches title or description, case-insensitive |
| `category` | | Exact category |
| `authorId` | | Only this author's recipes. Use your own ID for "my recipes" |
| `bOnlySaved` | | `true` for only recipes the user saved |
| `bHideSaved` | | `true` to leave out recipes the user saved, which includes their own. Can't be combined with `bOnlySaved` |
| `tags` | | Comma-separated, e.g. `italian,quick`. Recipes must have every tag. Tags are [normalised](#tags) before matching |
| `minTime` / `maxTime` | | Total minutes (`prepTime + cookTime`), inclusive |
| `minServes` / `maxServes` | | Inclusive |
| `sort` | newest | `oldest`, `title` or `popular` (most saved) |
| `page` | `1` | |
| `limit` | `10` | |

Only returns recipes the user can see: their own, plus other users' public ones. Recipes without an author only appear with `bOnlySaved=true`.

The `tags` filter uses the user's personal edit when it changes a recipe's tags, matching the tags shown in the results.

**200:** note that `data` is the list itself:

```ts
{
  status, results: number, totalPages: number, currentPage: number,
  data: (Recipe & { pendingSuggestions: number })[]
}
```

`pendingSuggestions` is how many suggestions are waiting for the author to review. It's only counted on the user's own recipes, and is always `0` on anyone else's.

**Errors:**
- `INVALID_ID` (400) for a malformed `authorId`.
- `INVALID` (400) if a time or serves param isn't a number of 0 or more.
- `INVALID_OPTIONS` (400) if both `bOnlySaved` and `bHideSaved` are `true`.

### `GET /recipes/tags`

Existing tags for autocomplete, most used first. Only tags on recipes the user can see are included.

| Query param | Default | Notes |
|---|---|---|
| `search` | | Only tags containing this text. Case and spacing are ignored |
| `limit` | `10` | Up to 50 |

**200:**

```ts
{ status, data: { tags: { tag: string; count: number }[] } }
```

`count` is how many recipes use the tag.

### `GET /recipes/:id`

Query: `?original=true` returns the recipe without the user's personal edit.

**200:** `{ status, data: { recipe: Recipe, bHasEdits: boolean } }`

**Errors:** `INVALID_ID` (404) if the recipe doesn't exist or the user can't see it.

### `POST /recipes/toggle-save`

```json
{ "id": "<recipeId>", "bSave": true, "bConfirmLoseEdits": true }
```

`bConfirmLoseEdits` is only needed when unsaving a recipe the user has a personal edit on.

**200:** `{ status, data: null }`

**Errors:**
- `MISSING_FIELDS` (400) if `bSave` isn't a boolean.
- `INVALID_RECIPE` (404) if the recipe doesn't exist, or it's someone else's private recipe and the user is trying to save it.
- `CONFIRM_LOSE_EDITS` (400).
- `AUTHOR_CANT_UNSAVE` (400) if the user tries to unsave a recipe they wrote. Authors always have their own recipes saved. To remove one, they delete it.

### `PATCH /recipes/update-own-recipe`

Author only. Body: `{ "id", ...any create fields to change }`.

**200:** `{ status, data: { recipe: Recipe } }`

**Errors:**
- `INVALID_ID` (404).
- `USER_DOESNT_OWN_RECIPE` (400).
- `Validation_Error` (400).
- `INVALID_FIELDNAME` (401) for unknown fields.

### `POST /recipes/edit-recipe`

Makes a personal edit, or a suggestion when `isSuggestion` is `true`. The user must have saved the recipe and must not be its author.

```json
{
  "id": "<recipeId>",
  "isSuggestion": false,
  "ingredients": [...],
  "steps": [...],
  "tags": [...],
  "comments": "Only used for suggestions"
}
```

Every field except `id` is optional.

**200:** `{ status, data: { recipe: Recipe } }`. This is the recipe as the user now sees it. A suggestion isn't applied until the author accepts it.

**Errors:**
- `INVALID_RECIPE` (400) if the recipe isn't saved or doesn't exist.
- `USE_UPDATE_OWN_RECIPE_ENDPOINT` (400) if the user is the author.
- `NO_SUGGESTIONS` (400) if the recipe doesn't allow suggestions.
- `Validation_Error` (400).
- `INVALID_FIELDNAME` (401) for unknown fields.

### `POST /recipes/reset-edit`

Body: `{ "id": "<recipeId>" }`. Deletes the user's personal edit.

**200:** `{ status, data: null }`

**Errors:** `INVALID_ID` (404) if there's no edit to reset.

### `POST /recipes/delete`

Author only. Body: `{ "id": "<recipeId>" }`. See [Recipes without an author](#recipes-without-an-author) for what happens to it.

**200:** `{ status, data: null }`

**Errors:** `INVALID_ID` (404).

### `GET /recipes/view-suggestions/:id`

Author only. Returns pending suggestions, newest first. Add `?bShowAll=true` to include accepted and rejected ones.

**200:** `{ status, data: { edits: Edit[] } }`

**Errors:** `INVALID_ID` (404).

### `POST /recipes/review-suggestion`

Author only.

```json
{ "id": "<suggestionId>", "bAccept": true }
```

**200:** `{ status, data: { recipe: Recipe, suggestion: Edit } }`

**Errors:**
- `MISSING_FIELDS` (400).
- `INVALID_ID` (404).
- `SUGGESTION_ALREADY_REVIEWED` (400).

### `GET /recipes/my-suggestions`

Every suggestion the user has made, newest first. `recipeId` is `{ id, title }`.

**200:** `{ status, results: number, data: { suggestions: Edit[] } }`

## Error codes

These are in `translations/errorCodes.ts`.

| Code | Meaning |
|---|---|
| `REQUIRED` | A required field is missing |
| `CONFIRM` | `passwordConfirm` is missing |
| `INVALID` | A field is invalid, for example a badly formatted email |
| `INVALID_ID` | The recipe doesn't exist or the user can't access it |
| `INVALID_FIELDNAME` | The request has a field that isn't allowed |
| `INVALID_RECIPE` | The recipe doesn't exist or the user can't use it this way |
| `INVALID_OPTIONS` | A value isn't one of the allowed options |
| `NO_SUGGESTIONS` | The recipe doesn't accept suggestions |
| `USE_UPDATE_OWN_RECIPE_ENDPOINT` | Authors change their recipe with `/update-own-recipe` |
| `USER_DOESNT_OWN_RECIPE` | Only the author can do this |
| `CONFIRM_LOSE_EDITS` | Unsaving will delete the user's edits: confirm with `bConfirmLoseEdits` |
| `SUGGESTION_ALREADY_REVIEWED` | The suggestion was already accepted or rejected |
| `USERNAME_TAKEN` | Username already in use |
| `UNIQUE_EMAIL` | Email already in use |
| `MISSING_EMAIL_PASSWORD` | Login needs both email and password |
| `INVALID_CREDENTIALS` | Wrong email or password |
| `INVALID_CURRENT_PASSWORD` | Wrong current password when changing it |
| `MISSING_FIELDS` | A required field is missing or has the wrong type |
| `Validation_Error` | Body validation failed: see `errors` |
