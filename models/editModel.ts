import mongoose, { Document, Schema, Types } from 'mongoose';
import { Ingredient } from './recipeModel';
import { ErrorCode } from 'translations/errorCodes';
import { Unit } from 'constants/recipeConstants';

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
  comments: string;
  status: EditStatus;
}

const EditSchema = new Schema<EditDocument>({
  recipeId: {
    type: Schema.Types.ObjectId,
    required: [true, ErrorCode.Required],
  },
  userId: { type: Schema.Types.ObjectId, required: [true, ErrorCode.Required] },
  isSuggestion: { type: Boolean, default: false },
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
  comments: [{ type: String, required: [true, ErrorCode.Required] }],
  status: {
    type: String,
    enum: Object.values(EditStatus),
    required: [true, ErrorCode.Invalid_Options],
    default: EditStatus.PENDING,
  },
});

const Edit = mongoose.model<EditDocument>('Edit', EditSchema);

export default Edit;
