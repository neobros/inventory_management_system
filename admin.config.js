/**
 * ============================================================================
 *  PLATFORM ADMIN LOGIN
 * ============================================================================
 *
 *  Set the email and password you want for the platform administrator — the
 *  account that creates and manages shops.
 *
 *  Then run:
 *
 *      npm run seed
 *
 *  That creates the login in Firebase Authentication and marks it as the super
 *  admin. Run it once, when you first set the project up.
 *
 *  Change the password below before running it. Once seeded, the admin can
 *  change their own password from "My Account" inside the app.
 */

export const adminAccount = {
  email: 'admin@neo.com',
  password: 'neo123456!',
  name: 'Super Admin',
}
