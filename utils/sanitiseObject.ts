import xss from 'xss';

export default (obj: Record<string, any>) => {
  const sanitizedObj: Record<string, any> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      sanitizedObj[key] = typeof value === 'string' ? xss(value) : value;
    }
  }
  return sanitizedObj;
};
