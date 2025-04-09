// Models
const users = {
  _id: 'ObjectId', // Unique identifier for the user
  username: 'string', // Unique username
  email: 'string', // Unique email
  password: 'string', // Hashed password
  passwordConfirm: 'string', // Hashed password
  passwordChangedAt: 'string', // When password was updated
  photo: 'string', // Uploaded profile photo
  savedRecipes: [
    {
      recipeId: 'ObjectId', // Reference to the Recipe
      personalEdits: 'ObjectId', // Reference to the user's edits for this recipe
    },
  ],
  suggestedEdits: [
    {
      recipeId: 'ObjectId', // Reference to the Recipe
      editId: 'ObjectId', // Reference to the suggested edit
    },
  ],
};

const recipes = {
  _id: 'ObjectId', // Unique identifier for the recipe
  authorId: 'ObjectId', // Reference to the User who created the recipe
  title: 'string', // Recipe title
  description: 'string', // Recipe description
  type: 'String', // Main, Starter, Dessert etc
  serves: 0, // How many it serves
  prepTime: 0, // How long the prep is in minutes
  cookTime: 0, // How long the cook is in minutes
  ingredients: [
    { subheader: 'String | null', quantity: 2, name: 'flour', unit: 'cups' },
  ], // List of ingredients
  steps: ['string'], // List of preparation steps
  tags: ['string'], // Tags or categories
  savedBy: ['ObjectId'], // List of User IDs who have saved this recipe
  suggestedEdits: [
    {
      editId: 'ObjectId', // Reference to the Edit
      userId: 'ObjectId', // User who suggested the edit
    },
  ],
};

const edits = {
  _id: 'ObjectId', // Unique identifier for the edit
  recipeId: 'ObjectId', // Reference to the Recipe being edited
  userId: 'ObjectId', // Reference to the User who made the edit
  isSuggestion: 'boolean', // Whether this edit is a suggestion
  ingredients: ['string'], // Updated ingredients (optional)
  steps: ['string'], // Updated steps (optional)
  comments: 'string', // Optional comments about the edit
  status: 'string', // Status of the suggestion (e.g., "pending", "accepted", "rejected")
};
