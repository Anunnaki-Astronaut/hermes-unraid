# Contributing

Small, focused changes are easiest to review.

## Before opening a pull request

1. Remove all real server data from fixtures, logs, and screenshots.
2. Keep the integration read-only. Do not add GraphQL mutations, SSH, MCP, or shell commands.
3. Preserve the dedicated `VIEWER` key requirement.
4. Run:

   ```bash
   python -m pip install -r requirements-dev.txt
   python -m pytest -q
   node --check desktop/plugin.js
   ```

5. Explain the visible behavior change and how you verified it.

## Screenshots

Use only synthetic data. The rendering helper loads the production Desktop component so screenshots stay close to the shipped UI:

```bash
node --experimental-vm-modules scripts/render_screenshot.cjs overview .screenshots-preview/overview.html
```

Supported tabs are `overview`, `array`, `docker`, `vms`, and `alerts`.

## Scope

Bug fixes, compatibility work, accessibility improvements, and clearer documentation are welcome. A control or repair feature needs a separate design and security review because it would change the project's trust boundary.
