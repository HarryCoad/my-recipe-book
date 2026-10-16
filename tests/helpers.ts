import request from 'supertest';
import app from '../app';

const BASE = '/api/v1';

export interface TestUser {
  id: string;
  token: string;
  username: string;
  email: string;
}

/** Send requests without being logged in */
export const api = {
  get: (path: string) => request(app).get(BASE + path),
  post: (path: string, body: object = {}) =>
    request(app)
      .post(BASE + path)
      .send(body),
};

/** Send requests as a logged in user, e.g. as(alice).get('/recipes/search') */
export const as = (user: TestUser) => {
  const auth = `Bearer ${user.token}`;
  return {
    get: (path: string) =>
      request(app)
        .get(BASE + path)
        .set('Authorization', auth),
    post: (path: string, body: object = {}) =>
      request(app)
        .post(BASE + path)
        .set('Authorization', auth)
        .send(body),
    patch: (path: string, body: object = {}) =>
      request(app)
        .patch(BASE + path)
        .set('Authorization', auth)
        .send(body),
    delete: (path: string) =>
      request(app)
        .delete(BASE + path)
        .set('Authorization', auth),
  };
};

/** Sign up a new user. Usernames must be at least 4 characters */
export const createUser = async (username: string): Promise<TestUser> => {
  const email = `${username}@test.com`;
  const res = await api.post('/users/signup', {
    username,
    email,
    password: 'password123',
    passwordConfirm: 'password123',
  });

  if (res.status !== 201) {
    throw new Error(`Signup failed: ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.data.user.id, token: res.body.token, username, email };
};

/** A valid recipe body. Pass overrides to change any field */
export const recipeBody = (overrides: object = {}) => ({
  title: 'Pancakes',
  description: 'Fluffy pancakes',
  category: 'Breakfast',
  serves: 2,
  prepTime: 10,
  cookTime: 15,
  ingredients: [{ quantity: 200, name: 'flour', unit: 'g' }],
  steps: ['Mix', 'Cook'],
  tags: ['quick'],
  bAllowSuggestions: true,
  ...overrides,
});

/** Create a recipe as the given user and return it */
export const createRecipe = async (user: TestUser, overrides: object = {}) => {
  const res = await as(user).post('/recipes/create', recipeBody(overrides));

  if (res.status !== 200) {
    throw new Error(`Create recipe failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.data.recipe;
};

/** Save (or unsave) a recipe as the given user */
export const saveRecipe = (user: TestUser, recipeId: string, bSave = true) =>
  as(user).post('/recipes/toggle-save', { id: recipeId, bSave });
