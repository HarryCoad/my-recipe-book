import mongoose, { Document, Schema, Types } from 'mongoose';
import { Ingredient, IngredientSchema } from './recipeModel';
import { ErrorCode } from 'translations/errorCodes';
import { normaliseTags } from '../utils/tagUtils';

export enum EditStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

export interface EditDocument extends Document<string> {
  recipeId: Types.ObjectId;
  userId: Types.ObjectId;
  isSuggestion: boolean;
  ingredients: Ingredient[];
  steps: string[];
  tags?: string[];
  comments: string;
  status: EditStatus;
}

const EditSchema = new Schema<EditDocument>({
  recipeId: {
    type: Schema.Types.ObjectId,
    ref: 'Recipe',
    required: [true, ErrorCode.Required],
  },
  userId: { type: Schema.Types.ObjectId, required: [true, ErrorCode.Required] },
  isSuggestion: { type: Boolean, default: false },
  ingredients: [IngredientSchema],
  steps: [{ type: String, required: [true, ErrorCode.Required] }],
  // Defaults to undefined rather than [] so "tags not edited" can be told
  // apart from "edited to remove all tags"
  tags: { type: [String], default: undefined, set: normaliseTags },
  comments: { type: String },
  status: {
    type: String,
    enum: Object.values(EditStatus),
    required: [true, ErrorCode.Invalid_Options],
    default: EditStatus.PENDING,
  },
});

// Edits are looked up by recipe, and by recipe + user (view, search results)
EditSchema.index({ recipeId: 1, userId: 1, isSuggestion: 1 });

const Edit = mongoose.model<EditDocument>('Edit', EditSchema);

export default Edit;
