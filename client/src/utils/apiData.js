export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function toId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) {
    throw new Error("A valid record ID is required. Return to the list and try again.");
  }
  return id;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    ...(Array.isArray(user.truncatedFields) ? { truncatedFields: [...new Set(user.truncatedFields.filter((field) => field === "name" || field === "email"))] } : {}),
  };
}
