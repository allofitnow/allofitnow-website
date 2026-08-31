import { CollectionConfig } from "payload/types";

const Users: CollectionConfig = {
  slug: "users",
  auth: {
    tokenExpiration: 28800, // #81: 8h workday (was 7200/2h default) - designers were auto-logged-out mid-edit; JWTs are stateless; logout only clears the cookie client-side
    cookies: {
      secure: false,
      sameSite: "lax",
    },
  },
  admin: {
    useAsTitle: "email",
  },
  access: {
    // Any logged-in user can read the user list (admin UI needs this for
    // relationship fields like createdBy/updatedBy on documents).
    read: ({ req: { user } }) => Boolean(user),
    // Only allow creating/updating your own record OR any (staging: all
    // editors are trusted). Tighten to `id === user.id` in production.
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: ({ req: { user } }) => Boolean(user),
  },
  fields: [
    { name: "name", type: "text" },
  ],
};

export default Users;
