# Architecture

AIHOT Core is unchanged in responsibility. Creator code is isolated under `packages/backend/src/creator/` and consumes completed Story data plus a bounded set of selected public publications as evidence.

The flow implemented in V1-A is:

`Story -> creator.opportunity worker job -> append-only opportunity analysis -> admin API -> /admin/opportunities`

The web process only reads the admin API. Model calls run only in the worker and continue to use the shared model, receipt, and budget infrastructure.
