# SysAid

Creates SysAid service records from feedback and, optionally, syncs their
status back to the post.

## Connecting

Settings → Integrations → SysAid. Enter the account URL (for cloud accounts,
`<account>.sysaidit.com`), and the username and password of a SysAid
administrator with REST API access. Quackback logs in once to verify, then
stores the pair encrypted as the integration's access token and logs in per
operation (`POST /api/v1/login`).

## What creates a record

Routing rows, exactly as for Slack or GitHub: each row is a SysAid category
(`problem_type`) with the triggers that create a record there — new post, vote
threshold, status change, edit — and conditions (boards, tags, minimum votes,
statuses). A post gets at most one record per integration; later triggers for
an already-linked post do nothing.

"Service record fields" adds the `info` entries every record is created with
(urgency, assigned group, initial status, custom keys). Title, description and
the routed category are always set. "Record type" picks the `?type=` of
`POST /api/v1/sr`.

## Status sync (optional)

Enable status sync and map SysAid statuses to post statuses. SysAid cannot
register webhooks itself, so create an escalation rule (or automation) that
sends an HTTP POST to the URL shown in the panel when a record's status
changes. The body may be JSON or form-encoded and needs the record id and the
status caption, e.g. `{"id": 42, "status": "Closed"}`; the secret from the
panel goes in an `X-Webhook-Secret` header or a `?secret=` query parameter.
