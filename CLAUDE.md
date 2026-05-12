# Xray – Claude Development Guidelines

## Protocol Research Rule

**Before implementing support for any protocol, network service, communication standard, or adding fields to an existing one:**

1. **Search the web first.** Use WebSearch to look up the protocol's RFC/spec, standard ports, modes, handshake flow, and known gotchas. Do not rely solely on training-data knowledge — protocols evolve and best practices shift.
2. **Identify every standard field.** A professional tool exposes all fields a real client would need: not just the happy path (host + port), but encryption modes, auth mechanisms, timeouts, edge-case headers, etc.
3. **Apply current best practices.** Note the year in the search and prefer current security recommendations (e.g., TLS 1.2+ only, implicit TLS over STARTTLS where both exist, no anonymous auth by default).
4. **Set sensible defaults.** Defaults should reflect what a secure, modern deployment looks like — not what was common in 2005.
5. **Write descriptive labels.** Every UI field must have:
   - A short **label** (the field name)
   - A one-line **description** below it explaining *what it is* and *when to change it*
   Example: instead of just labelling a field "Port", write "Port — 587 for STARTTLS submission (recommended), 465 for Implicit TLS, 25 for relay-to-relay only".
6. **Consider UX.** Group related fields, provide quick-select presets where relevant (e.g., common port buttons), and auto-update dependent fields when the user picks a preset (e.g., changing encryption mode auto-fills the standard port).

This rule applies to: new protocol plugins, new pages for existing protocols, and any PR that adds fields to an existing form.
