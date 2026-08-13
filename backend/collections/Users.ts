import { CollectionConfig } from "payload/types";

const Users: CollectionConfig = {
  slug: "users",
  auth: {
    tokenExpiration: 7200, // 2 hours (default) — JWTs are stateless; logout only clears the cookie client-side
    cookies: {
      secure: false, // staging over plain HTTP
      sameSite: "lax",
    },
  },
  admin: {
    useAsTitle: "email",
  },
  fields: [
    { name: "name", type: "text" },
  ],
};

export default Users;
