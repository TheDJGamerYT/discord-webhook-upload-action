# Discord Webhook Upload Action

An action that lets you upload files and send them as discord webhooks!

Example:
```yaml
- name: Publish artifacts
  uses: TheDJGamerYT/discord-webhook-upload-action@v0.2
  with:
    # the discord webhook url
    url: ${{ secrets.WEBHOOK_URL }}
    username: george washington
    avatar: 'https://i.imgur.com/uiFqrQh.png'
    
    message_commit: '> :sparkles: [${commitMessage}](<${commitUrl}>) by [${authorName}](<${authorUrl}>)'
    message_header: |
      <:new1:1253371736510959636><:new2:1253371805734015006> New dev build `#${{ github.run_number }}`:
        
    file: 'build/libs/*'
```

(Example from [Adventures in Time by AmbleLabs](https://github.com/amblelabs/ait/blob/main/.github/workflows/publish-devbuilds.yml))



## Inputs

| Name                   | Description                                                                 | Default      |
|------------------------|-----------------------------------------------------------------------------|-------------|
| `url`                  | The Discord webhook URL                                                     | *(required)*|
| `username`             | Username to display for the webhook                                         | `Username`  |
| `avatar`               | Avatar image URL for the webhook                                            | *(empty)*   |
| `file`                 | Glob pattern for files to upload                                            | *(empty)*   |
| `mode`                 | Action mode (currently only `commit` supported)                             | `commit`    |
| `message_header`       | Message header (sent before commit messages)                                | See example |
| `message_commit`       | Per-commit message format                                                   | See example |
| `split_length`         | Maximum message length before splitting (Discord max: 2000)                  | `2000`      |
| `split_char`           | Character to split messages on (e.g. `\n`, `;`, etc.)                      | `\n`       |
| `file_attach_mode`     | Attach files to every message (`always`), only last (`last`), or never      | `last`      |
| `webhook_suppress_errors` | Suppress webhook errors (true/false)                                      | `false`     |

### Advanced Customization

- **split_length**: If your message exceeds this length, it will be split into multiple Discord messages. Useful for long commit logs or build reports.
- **split_char**: Change how messages are split (default is newline). For example, use `;` to split on semicolons.
- **file_attach_mode**:
  - `always`: Attach files to every message part.
  - `last`: Attach files only to the last message part (default).
  - `never`: Never attach files.
- **webhook_suppress_errors**: If set to `true`, errors from Discord webhook requests will be suppressed (useful for non-blocking notifications).

## Formatting

You can use placeholders in your message formats:

### Commit placeholders

- `${commitMessage}` - commit message
- `${commitUrl}` - link to the commit
- `${authorName}` - the author of the commit
- `${authorUrl}` - link to the author's profile

## Example Usage

```yaml
- name: Publish artifacts
  uses: TheDJGamerYT/discord-webhook-upload-action@v0.2
  with:
    url: ${{ secrets.WEBHOOK_URL }}
    username: george washington
    avatar: 'https://i.imgur.com/uiFqrQh.png'
    message_commit: '> :sparkles: [${commitMessage}](<${commitUrl}>) by [${authorName}](<${authorUrl}>)'
    message_header: |
      <:new1:1253371736510959636><:new2:1253371805734015006> New dev build `#${{ github.run_number }}`:
    file: 'build/libs/*'
    split_length: 1500
    split_char: '\n'
    file_attach_mode: 'last'
    webhook_suppress_errors: 'false'
```

## Tips

- Use glob patterns for `file` to upload multiple files (e.g., `build/libs/*`).
- Customize message formatting for different modes by using `message_<mode>`.
- Use GitHub Actions variables in your messages for dynamic content.

## Troubleshooting

- If your webhook fails, check the Discord webhook URL and permissions.
- If you want to ignore webhook errors, set `webhook_suppress_errors` to `true`.

## License

MIT