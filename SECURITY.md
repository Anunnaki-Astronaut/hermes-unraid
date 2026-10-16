# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository instead of opening a public issue.

Include:

- the affected plugin version;
- the Hermes and Unraid versions;
- the smallest set of steps needed to reproduce the problem;
- the security impact you observed.

Remove API keys, URLs, hostnames, IP addresses, notification text, and other server details before attaching logs or screenshots.

## Security boundaries

Hermes Unraid is read-only by design. It uses fixed GraphQL queries and does not provide arbitrary GraphQL, mutations, SSH, MCP, or shell access. The Unraid key should always use the `VIEWER` role.

HTTPS certificate verification is always enabled. Plain HTTP is available only through an explicit setting for trusted private networks.

A security report is especially useful if it shows any of these boundaries can be bypassed.
