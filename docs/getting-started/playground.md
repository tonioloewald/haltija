# Playground

This is a sandbox for testing Haltija commands. The elements below are designed for agents to practice interacting with web pages.

## Interactive Elements

Use these to test clicking, typing, and reading page content.

### Buttons

<div class="test-buttons">
  <button id="btn-primary" class="btn-test primary">Primary Button</button>
  <button id="btn-secondary" class="btn-test secondary">Secondary Button</button>
  <button id="btn-danger" class="btn-test danger">Danger Button</button>
</div>

### Form Inputs

<div class="test-form">
  <div class="form-row">
    <label for="text-input">Text Input:</label>
    <input type="text" id="text-input" placeholder="Type something here...">
  </div>
  <div class="form-row">
    <label for="email-input">Email:</label>
    <input type="email" id="email-input" placeholder="you@example.com">
  </div>
  <div class="form-row">
    <label for="select-input">Dropdown:</label>
    <select id="select-input">
      <option value="">Choose an option...</option>
      <option value="a">Option A</option>
      <option value="b">Option B</option>
      <option value="c">Option C</option>
    </select>
  </div>
  <div class="form-row">
    <label>Checkboxes:</label>
    <div class="checkbox-group">
      <label><input type="checkbox" id="check-1"> Option 1</label>
      <label><input type="checkbox" id="check-2"> Option 2</label>
      <label><input type="checkbox" id="check-3"> Option 3</label>
    </div>
  </div>
</div>

### Output Area

<div id="output" class="output-box">
  Click buttons or type in fields to see results here.
</div>

## Test Commands

Try these commands to interact with the playground:

```bash
# Click the primary button
hj click "#btn-primary"

# Type in the text input
hj type "#text-input" "Hello from the agent!"

# Read the output area
hj query "#output"

# Get all form values
hj eval 'JSON.stringify({text: document.getElementById("text-input").value, email: document.getElementById("email-input").value})'
```
