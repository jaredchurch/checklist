# Gemini CLI Mandates

This file contains foundational mandates for Gemini CLI. These instructions take absolute precedence over general workflows and tool defaults.

## Code Standards
- **Segregation**: CSS, JavaScript, and HTML MUST be kept in separate files. Never use internal `<style>` or `<script>` tags in HTML files. All styling must reside in `.css` files and all logic in `.js` files.
- **Documentation**: Always include descriptive file headers and inline comments. Comments should focus on explaining the "why" of the implementation logic to ensure long-term maintainability.
- **Project Structure**: The `www/` directory is the root for all served assets. Maintain this structure when adding new features.

## Validation
- **Post-Change Verification**: After code modifications, you should offer to run `npm run lint` followed by `npm test`. Do not run these automatically unless explicitly requested by the user.
