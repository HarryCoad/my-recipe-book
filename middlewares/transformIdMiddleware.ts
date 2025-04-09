import { NextFunction, Request, Response } from 'express';

// Recursive function to traverse and transform _id to id in the response object
const transformIdRecursive = (obj: any, visited: Set<any> = new Set()) => {
  // Prevent circular references by checking if the object has been visited
  if (visited.has(obj)) {
    return;
  }
  visited.add(obj);

  // If it's an object, iterate over its properties
  if (obj && typeof obj === 'object') {
    // If it's an array, process each item in the array
    if (Array.isArray(obj)) {
      obj.forEach((item) => transformIdRecursive(item, visited));
    } else {
      // Iterate over the keys of the object
      Object.keys(obj).forEach((key) => {
        // If the key is _id, replace it with id
        if (key === '_id') {
          obj.id = obj._id;
          delete obj._id; // Remove _id after conversion
        } else {
          // Recursively check nested properties
          transformIdRecursive(obj[key], visited);
        }
      });
    }
  }
};

export const transformIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Convert incoming 'id' field to '_id'
  // if (req.body && req.body.id) {
  //   req.body._id = req.body.id;
  //   delete req.body.id; // Remove the 'id' field
  // }

  // Modify the response before sending it out
  const oldJson = res.json;
  res.json = (body) => {
    // If the body is an object, apply the recursive transformation
    if (body && typeof body === 'object') {
      transformIdRecursive(body);
    }

    // Continue with the original response process
    return oldJson.call(res, body);
  };

  next();
};
