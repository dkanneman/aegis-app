export type AegisUser = {
  email: string;
  displayName: string;
};

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";

function decodedName(headers: Headers) {
  const encoded = headers.get(USER_FULL_NAME_HEADER);
  if (
    !encoded ||
    headers.get(USER_FULL_NAME_ENCODING_HEADER) !== "percent-encoded-utf-8"
  ) {
    return null;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function getAegisApiUser(request: Request): AegisUser | null {
  const email = request.headers.get(USER_EMAIL_HEADER);
  if (email) {
    return {
      email: email.toLowerCase(),
      displayName: decodedName(request.headers) ?? email,
    };
  }

  if (process.env.NODE_ENV !== "production") {
    return { email: "local-preview@aegis.test", displayName: "Aegis Tester" };
  }

  return null;
}
