# Telegram Salary Bot

This is a Telegram bot that provides salary date information and sends daily notifications. It's designed to run as a serverless function on Netlify and uses GitHub Actions for scheduled tasks.

## Features

- Fetch the next salary date on demand using the `/when_salary` command
- Automatic daily notifications about the time remaining until the next salary
- Handles Ukrainian holidays and weekend adjustments for salary dates
- Deployed as a serverless function on Netlify
- Uses GitHub Actions for scheduled daily notifications

## Setup

### Prerequisites

- A Telegram Bot Token (obtain from BotFather)
- A Netlify account
- A GitHub account

### Deployment Steps

1. Fork this repository to your GitHub account.

2. Set up a new site on Netlify:
   - Connect your GitHub repository to Netlify
   - Set the build command to `npm install`
   - Set the publish directory to `functions`

3. Set up environment variables in Netlify:
   - Go to Site settings > Build & deploy > Environment
   - Add a variable named `TOKEN` with your Telegram Bot Token as the value

4. Deploy your site on Netlify.

5. Set up the Telegram webhook:
   - Replace `<YOUR_BOT_TOKEN>` and `<YOUR_NETLIFY_URL>` in the following URL and open it in a browser:
     ```
     https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_NETLIFY_URL>/.netlify/functions/bot
     ```

6. Set up GitHub Actions:
   - In your GitHub repository, go to Settings > Secrets and variables > Actions
   - Add a new repository secret named `NETLIFY_FUNCTION_URL` with your Netlify function URL as the value

## Usage

Once set up, you can interact with the bot on Telegram:

- Send `/when_salary` to get information about the next salary date
- The bot will automatically send daily updates to the specified chat about the time remaining until the next salary

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available under the [MIT License](LICENSE).