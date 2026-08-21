# React Router warnings

The development console currently reports the following React Router future
flags:

- `v7_startTransition`
- `v7_relativeSplatPath`

These are compatibility notices, not current application failures. React
Router v6 is warning that state updates and relative paths inside splat routes
will change behavior in v7.

## Future migration options

1. Opt into each future flag on the application's router once the existing
   routes have been reviewed. This exposes v7 behavior while the application
   still runs on v6 and lets tests catch affected navigation early.
2. Upgrade React Router in a dedicated dependency task, then remove the flags
   that are no longer needed. Review nested routes, links under splat routes,
   loaders/actions, and transition-sensitive UI during that upgrade.
3. Keep the warnings enabled in development until migration is complete. Do
   not hide them globally, because they are useful signals for route behavior
   changes.

Before opting in, add focused tests for nested and splat-route navigation and
run the complete web test suite. The warnings observed during browser testing
did not block authentication, recipe CRUD, AI generation, or the recipe
assistant.
