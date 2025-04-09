import {
  RECIPE_PRIVATE_DEFAULT,
  RECIPE_SUGGESTIONS_DEFAULT,
  RecipeCategory,
  RecipeType,
  Unit,
} from '../constants/recipeConstants';
import mongoose, { Document, Query, Schema, Types } from 'mongoose';
import { ErrorCode } from '../translations/errorCodes';

export interface SavedRecipe {
  recipeId: Types.ObjectId;
  personalEdits?: Types.ObjectId;
}

export type Ingredient = {
  subheader?: string | null;
  quantity: number;
  name: string;
  unit: Unit;
};

export interface RecipeDocument extends Document<string> {
  authorId: Types.ObjectId;
  authorType: 'User' | 'RecipeBook';
  bPrivate: boolean;
  bAllowSuggestions: boolean;
  title: string;
  description: string;
  category: RecipeCategory;
  serves: number;
  prepTime: number; // minutes
  cookTime: number; // minutes
  ingredients: Ingredient[];
  steps: string[];
  tags: string[];
  savedBy: Types.ObjectId[];

  bDeleted: boolean;
}

/* Recipe lookup example with authorId being dependant on two tables
const recipe = await Recipe.findById(recipeId)
  .populate({
    path: "authorId",
    model: recipe.authorType, // Dynamically use either "User" or "RecipeBook"
  })
  .exec();
*/

const RecipeSchema = new Schema<RecipeDocument>(
  {
    authorId: {
      type: Schema.Types.ObjectId,
      required: [true, ErrorCode.Required],
    },
    authorType: {
      type: String,
      enum: Object.values(RecipeType),
      default: RecipeType.User,
    },
    bPrivate: { type: Boolean, default: RECIPE_PRIVATE_DEFAULT },
    bAllowSuggestions: { type: Boolean, default: RECIPE_SUGGESTIONS_DEFAULT },
    title: { type: String, required: [true, ErrorCode.Required] },
    description: { type: String, required: false },
    category: {
      type: String,
      enum: Object.values(RecipeCategory),
      required: [true, ErrorCode.Invalid_Options],
    },
    serves: { type: Number, required: [true, ErrorCode.Required] },
    prepTime: { type: Number, required: [true, ErrorCode.Required] },
    cookTime: { type: Number, required: [true, ErrorCode.Required] },
    ingredients: [
      {
        subheader: { type: String, default: null },
        quantity: { type: Number, required: [true, ErrorCode.Required] },
        name: { type: String, required: [true, ErrorCode.Required] },
        unit: {
          type: String,
          enum: Object.values(Unit),
          required: [true, ErrorCode.Invalid_Options],
        },
      },
    ],
    steps: [{ type: String, required: [true, ErrorCode.Required] }],
    tags: [{ type: String }],
    savedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    bDeleted: { type: Boolean, default: false },
  },
  {
    toJSON: {
      versionKey: false,
    },
  },
);

// Filter out any soft deleted recipes
// RecipeSchema.pre(
//   /^find/,
//   function (this: Query<RecipeDocument, RecipeDocument>, next) {
//     this.setQuery({
//       ...this.getQuery(),
//       $or: [{ bDeleted: false }, { bDeleted: { $exists: false } }], // Include docs without bDeleted field
//     });
//     next();
//   },
// );

const Recipe = mongoose.model<RecipeDocument>('Recipe', RecipeSchema);

export default Recipe;
