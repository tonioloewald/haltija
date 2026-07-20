# Upstream items

Cross-repo work surfaced by haltija reviews. **We file, we don't fix** — never edit another repo
directly. Each entry links the issue once filed.

## tosijs-ui — dev-server test lane should drive a `--private` haltija, not adopt the shared browser

**Status:** to file (surfaced by the haltija 1.5.0 pre-release review).

`tosijs-ui`'s `dev-server.js` test mode runs an unscoped `hj windows` adopt check, so it consults
and can navigate whatever browser is live on the shared 8700 server — yanking a developer's live
browser to different pages, then failing on a timeout. This is the exact hazard that motivated
haltija issue #1.

haltija 1.5.0 ships the fix on our side: `haltija --private` (and `--private --app`) gives an
isolated server + browser on an ephemeral port that is never adopted by interactive `hj`. The
consumer needs to migrate: request a `--private` instance and drive **that** by the port it
reports (`--port-file` / `HALTIJA_PRIVATE_READY`), instead of the unscoped `hj windows` check.

Closing haltija #1 removes the field bug; it does **not** change the consumer until tosijs-ui
migrates. Issue URL: _(pending)_
