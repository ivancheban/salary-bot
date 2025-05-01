// index.js

// Dependencies
const { Telegraf } = require('telegraf');
const moment = require('moment-timezone');

// --- Configuration ---
const BOT_TOKEN = process.env.TOKEN;
const KYIV_TZ = 'Europe/Kiev';
const CHAT_ID = '-1001581609986'; // Your target group chat ID
const COMMAND_COOLDOWN_MS = 5000; // 5 seconds cooldown per user for the command

// --- Basic Startup Check ---
if (!BOT_TOKEN) {
    console.error("FATAL ERROR: Bot token not provided in environment variable 'TOKEN'");
    throw new Error("Bot token not provided in environment variable 'TOKEN'");
}

const bot = new Telegraf(BOT_TOKEN);

// --- State ---
let lastNotificationDate = null; // For daily notification dedupe (stateless env caveats apply)
const userLastCommandTime = {}; // For user command cooldown (in-memory)

// --- Date/Holiday Functions ---
function easter(year) { /* ... unchanged ... */
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
    const e = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - d - (c % 4)) % 7;
    const f = d + e - 7 * Math.floor((a + 11 * d + 22 * e) / 451) + 114;
    const month = Math.floor(f / 31);
    const day = (f % 31) + 1;
    return moment.tz([year, month - 1, day], KYIV_TZ);
}
function isUkrainianHoliday(date) { /* ... unchanged ... */
    const year = date.year();
    const month = date.month() + 1; // moment month is 0-based
    const day = date.date();

    const fixedHolidays = [
        [1, 1], [1, 7], [3, 8], [5, 1], [5, 9],
        [6, 28], [8, 24], [10, 14], [12, 25],
    ];

    if (fixedHolidays.some(([m, d]) => month === m && day === d)) {
        return true;
    }

    const easterDate = easter(year);
    const trinityDate = easterDate.clone().add(49, 'days'); // Pentecost/Trinity Sunday

    if (date.isSame(trinityDate, 'day')) {
         return true;
    }
    return false;
}

// --- Salary Calculation Logic ---

// Helper function for Weekend/Holiday Adjustment
function adjustForWeekendHoliday(dateToAdjust, timezone) {
    let adjustments = 0;
    const maxAdjustments = 7;
    let adjustedDate = dateToAdjust.clone();

    while (adjustments < maxAdjustments) {
        const dayOfWeek = adjustedDate.day(); // 0 = Sunday, 6 = Saturday
        if (dayOfWeek === 0 || dayOfWeek === 6 || isUkrainianHoliday(adjustedDate)) {
            adjustedDate.subtract(1, 'day');
            adjustments++;
            continue;
        }
        break;
    }
     if (adjustments >= maxAdjustments) {
          console.error("[adjustDate] Exceeded maximum holiday/weekend adjustments for target " + dateToAdjust.format('YYYY-MM-DD'));
          return dateToAdjust; // Return original on excessive failure
     }
     if (adjustments > 0 && !dateToAdjust.isSame(adjustedDate ,'day')) {
          console.log(`[adjustDate] Original target ${dateToAdjust.format('YYYY-MM-DD')} adjusted to ${adjustedDate.format('YYYY-MM-DD')} due to weekend/holiday.`);
     }
    return adjustedDate;
}

// Main function to determine the NEXT salary date
function getNextSalaryDate(currentDate) {
    console.log('[getNextSalaryDate] Calculating for input date:', currentDate.format('YYYY-MM-DD HH:mm:ss Z'));
    const salaryTime = { hour: 12, minute: 10, second: 0, millisecond: 0 };
    const currentYear = currentDate.year();

    // --- Handle specific 2025 override FIRST ---
    if ( (currentDate.year() === 2024 && currentDate.month() === 11 && currentDate.date() >= 27) ||
         (currentDate.year() === 2025 && currentDate.month() === 0) )
    {
         let nextSalaryBase = moment.tz([2025, 1, 5], KYIV_TZ); // Base: Feb 5, 2025
         console.log('[getNextSalaryDate] Special case: Late Dec 2024 / Jan 2025 -> Targeting Feb 5, 2025');
         let nextSalaryAdjusted = adjustForWeekendHoliday(nextSalaryBase, KYIV_TZ);
         nextSalaryAdjusted.set(salaryTime); // Set time AFTER adjustment
         console.log('[getNextSalaryDate] Final next salary date (special case):', nextSalaryAdjusted.format('YYYY-MM-DD HH:mm:ss Z'));
         return nextSalaryAdjusted;
    }

    // --- Define all potential TARGET salary dates (before adjustment) ---
    const targetDates = [];
    for (let yearOffset = 0; yearOffset <= 1; yearOffset++) { // Check current and next year
        const year = currentYear + yearOffset;
        targetDates.push(moment.tz([year, 1, 5], KYIV_TZ));  // Feb 5
        targetDates.push(moment.tz([year, 2, 5], KYIV_TZ));  // Mar 5
        targetDates.push(moment.tz([year, 3], KYIV_TZ).endOf('month')); // Apr EOM (e.g., Apr 30)
        targetDates.push(moment.tz([year, 5, 5], KYIV_TZ));  // Jun 5
        targetDates.push(moment.tz([year, 7, 5], KYIV_TZ));  // Aug 5
        targetDates.push(moment.tz([year, 8, 5], KYIV_TZ));  // Sep 5
        targetDates.push(moment.tz([year, 10, 5], KYIV_TZ)); // Nov 5
        if (year === 2024) { // Specific Dec 2024 adjustment
            targetDates.push(moment.tz([2024, 11, 30], KYIV_TZ));
        } else { // General Dec EOM
            targetDates.push(moment.tz([year, 11], KYIV_TZ).endOf('month'));
        }
    }

    // --- Find the first target date strictly after the current date's day ---
    targetDates.sort((a, b) => a.valueOf() - b.valueOf());
    let nextSalaryTarget = null;
    for (const targetDate of targetDates) {
        if (targetDate.isAfter(currentDate, 'day')) {
            nextSalaryTarget = targetDate.clone();
            console.log(`[getNextSalaryDate] Found next target salary date (before adjustment): ${nextSalaryTarget.format('YYYY-MM-DD')}`);
            break;
        }
    }

    if (!nextSalaryTarget) {
         console.error("[getNextSalaryDate] FATAL: Could not determine the next salary date!");
         return moment().add(10, 'years'); // Return error date
    }

    // --- Apply Weekend/Holiday Adjustment ---
    let nextSalaryAdjusted = adjustForWeekendHoliday(nextSalaryTarget, KYIV_TZ);

    // --- Set the specific time AFTER adjustments ---
    nextSalaryAdjusted.set(salaryTime);

    console.log('[getNextSalaryDate] Final next salary date (after adjustment & time set):', nextSalaryAdjusted.format('YYYY-MM-DD HH:mm:ss Z'));
    return nextSalaryAdjusted;
}


// --- Message Formatting ---
function getSalaryMessage(now, nextSalary) { /* ... unchanged ... */
    if (!moment.isMoment(now) || !moment.isMoment(nextSalary)) {
        console.error("[getSalaryMessage] Invalid input: 'now' or 'nextSalary' is not a moment object.");
        return "Error calculating time difference.";
    }

    if (now.isSame(nextSalary, 'day')) {
        if (now.isSameOrAfter(nextSalary)) {
             return "🎉🎊 Salary has arrived! 💰💸 Check your accounts! 🥳🍾";
        } else {
             const differenceToday = nextSalary.diff(now);
             const durationToday = moment.duration(differenceToday);
             const hoursToday = Math.floor(durationToday.asHours());
             const minutesToday = durationToday.minutes();
             const secondsToday = durationToday.seconds();
              return `🎉 It's Salary Day! Just ${hoursToday}h ${minutesToday}m ${secondsToday}s left until 12:10 PM! 💰`;
        }
    }

    const difference = nextSalary.diff(now);
    if (difference < 0) {
        console.warn(`[getSalaryMessage] Calculated next salary date (${nextSalary.format()}) is in the past relative to now (${now.format()}). Check calculation logic.`);
         return `🤔 Calculating next salary... The date seems to be in the past. Please check again shortly or contact admin.`;
    }

    const duration = moment.duration(difference);
    const days = Math.floor(duration.asDays());
    const hours = duration.hours();
    const minutes = duration.minutes();
    const seconds = duration.seconds();

    if (days === 0) {
        return `⏰ Almost there! Only ${hours}h ${minutes}m ${seconds}s left until Salary Day! 💰 Get ready! 🎉`;
    } else if (days === 1) {
        return `⏰ Just 1 day, ${hours}h ${minutes}m left until Salary Day! 💰 The final countdown! 🎉`;
    } else if (days === 2) {
        return `🗓️ 2 days to go until Salary Day! 💼 Keep up the great work! 😊`;
    } else if (days === 3) {
        return `📅 3 days remaining until Salary Day! 💰 Planning time! 🙌`;
    } else {
        const countdownText = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        const nextSalaryText = `Next Salary: ${nextSalary.format('dddd, MMMM D, YYYY')} at ${nextSalary.format('HH:mm')}`;
        return `⏳ Time until next salary: ${countdownText}\n📆 ${nextSalaryText}`;
    }
}

// --- Bot Event Handlers ---
bot.on('message', async (ctx) => { /* ... unchanged (includes cooldown) ... */
    const chatInfo = ctx.chat;
    const userInfo = ctx.from;
    const messageText = ctx.message?.text;
    const nowMs = Date.now();

    console.log(`\n--- [Message Received] ---`);
    console.log(`Timestamp: ${new Date(nowMs).toISOString()}`);
    console.log(`Chat ID: ${chatInfo.id} | Type: ${chatInfo.type} | Title: ${chatInfo.title || 'N/A'}`);
    console.log(`User ID: ${userInfo.id} | @${userInfo.username || 'N/A'} | ${userInfo.first_name}`);
    console.log(`Message Text: "${messageText || '[Non-text]'}"`);
    console.log(`--------------------------\n`);

    if (messageText) {
        const botUsername = ctx.botInfo?.username;
        const commandMatches = messageText === '/when_salary' || (botUsername && messageText === `/when_salary@${botUsername}`);

        if (commandMatches) {
            const userId = userInfo.id;
            const lastTime = userLastCommandTime[userId] || 0;

            if (nowMs - lastTime < COMMAND_COOLDOWN_MS) {
                console.log(`[Cooldown] User ${userId} triggered command too quickly. Ignoring.`);
                return; // Stop processing
            }
            userLastCommandTime[userId] = nowMs; // Update last command time


            console.log(`[Message Handler] Command /when_salary detected from User ${userId} in chat ${chatInfo.id}`);
            const calculationStart = moment().tz(KYIV_TZ);

            try {
                const nextSalary = getNextSalaryDate(calculationStart.clone());
                const message = getSalaryMessage(calculationStart, nextSalary);

                console.log(`[Message Handler] Replying to User ${userId} in chat ${chatInfo.id}`);
                await ctx.reply(message);
                console.log(`[Message Handler] Replied successfully.`);

            } catch (calculationError) {
                 console.error(`[Message Handler] Error during salary calculation/reply for User ${userId} in chat ${chatInfo.id}:`, calculationError);
                 try {
                    // Avoid replying with error if cooldown was the reason
                    if (!(nowMs - lastTime < COMMAND_COOLDOWN_MS)) {
                         await ctx.reply("Sorry, an error occurred while calculating the salary date.");
                    }
                 } catch (errorReplyError) {
                     console.error(`[Message Handler] Failed to send error reply in chat ${chatInfo.id}:`, errorReplyError);
                 }
            }
        }
    }
});

// --- Notification Function ---
async function sendDailyNotification(targetChatId) { /* ... unchanged ... */
    const now = moment().tz(KYIV_TZ);
    console.log(`[Notification] Generating notification for chat ${targetChatId} at Kyiv time:`, now.format());

    try {
        const nextSalary = getNextSalaryDate(now.clone());
        const message = getSalaryMessage(now, nextSalary);
        console.log('[Notification] Notification message:', message);

        await bot.telegram.sendMessage(targetChatId, message);
        console.log('[Notification] Daily notification sent successfully to chat:', targetChatId);
        return true;

    } catch (error) {
        console.error(`[Notification] Failed to send daily notification to chat ${targetChatId}:`, error);
        if (error.response?.error_code === 403) {
             console.error(`[Notification] Bot might be blocked or kicked from chat ${targetChatId}.`);
        } else if (error.response?.error_code === 400 && error.response?.description.includes("chat not found")) {
             console.error(`[Notification] Chat ${targetChatId} not found.`);
        }
        return false;
    }
}

// --- Serverless Function Handler ---
exports.handler = async (event, context) => { /* ... unchanged ... */
    const startTime = Date.now();
    const invocationId = context?.awsRequestId || `local-${startTime}`;
    console.log(`[Handler - ${invocationId}] Function started at: ${new Date(startTime).toISOString()}`);

    try {
        let requestBody = null;
        if (event.body && typeof event.body === 'string') {
            try { requestBody = JSON.parse(event.body); } catch (e) { console.error(`[Handler - ${invocationId}] JSON parse error:`, e); return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
        } else if (event.update_id) { requestBody = event;
        } else if (event.trigger === 'daily_notification' || event.source === 'aws.events' || event['detail-type']) { requestBody = { trigger: 'daily_notification' };
        } else { requestBody = {}; }

        console.log(`[Handler - ${invocationId}] Processing request type: ${requestBody.trigger ? 'Notification Trigger' : (requestBody.update_id ? 'Telegram Update' : 'Unknown')}`);

        if (requestBody.trigger === 'daily_notification') {
            const now = moment().tz(KYIV_TZ);
            const today = now.format('YYYY-MM-DD');
            if (lastNotificationDate !== today) {
                console.log(`[Handler - ${invocationId}] Sending daily notification for ${today} (Last: ${lastNotificationDate || 'None'})`);
                const success = await sendDailyNotification(CHAT_ID);
                if (success) { lastNotificationDate = today; console.log(`[Handler - ${invocationId}] Daily notification successful.`); return { statusCode: 200, body: JSON.stringify({ message: 'Daily notification sent successfully' }) };
                } else { console.error(`[Handler - ${invocationId}] Daily notification failed.`); return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send daily notification' }) }; }
            } else { console.log(`[Handler - ${invocationId}] Daily notification already processed today (${today}). Skipping.`); return { statusCode: 200, body: JSON.stringify({ message: 'Notification already processed today' }) }; }
        }
        else if (requestBody.update_id) {
            console.log(`[Handler - ${invocationId}] Handling Telegram update_id: ${requestBody.update_id}`);
             if (!bot.botInfo) {
                 try { bot.botInfo = await bot.telegram.getMe(); console.log(`[Handler - ${invocationId}] Fetched bot info: @${bot.botInfo.username}`);
                 } catch (e) { console.error(`[Handler - ${invocationId}] Failed to fetch bot info:`, e); }
             }
            await bot.handleUpdate(requestBody);
            console.log(`[Handler - ${invocationId}] Telegram update processed.`);
            return { statusCode: 200, body: JSON.stringify({ message: 'OK' }) };
        }
        else { console.log(`[Handler - ${invocationId}] Unrecognized request payload.`); return { statusCode: 400, body: JSON.stringify({ error: 'Unrecognized request' }) }; }
    } catch (e) { console.error(`[Handler - ${invocationId}] Critical error:`, e); return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
    } finally { console.log(`[Handler - ${invocationId}] Function finished. Duration: ${Date.now() - startTime}ms`); }
};

// --- Utility Function (for local testing) ---
function getSalaryDatesForYear(yearToTest) { /* ... unchanged ... */
    console.log(`\n[getSalaryDatesForYear] Calculating expected salary dates for ${yearToTest}...`);
    let currentDate = moment.tz([yearToTest - 1, 11, 31], KYIV_TZ);
    let salaryDates = new Set();
    let calculationCount = 0;
    const maxCalculations = 24;

    while (currentDate.year() < yearToTest + 1 && calculationCount < maxCalculations) {
        calculationCount++;
        let nextSalaryDate = getNextSalaryDate(currentDate.clone());

        // Check for the error date potentially returned by getNextSalaryDate
        if (nextSalaryDate.year() >= currentDate.year() + 5) {
             console.error("[getSalaryDatesForYear] getNextSalaryDate returned an error date. Aborting test.");
             break;
        }

        if (nextSalaryDate.year() === yearToTest) {
            const formattedDate = nextSalaryDate.format('YYYY-MM-DD');
             if (!salaryDates.has(formattedDate)) {
                 salaryDates.add(formattedDate);
                 console.log(`[getSalaryDatesForYear] Found ${yearToTest} salary date: ${formattedDate} (${nextSalaryDate.format('dddd, HH:mm')})`); // Log time too
             }
        } else if (nextSalaryDate.year() > yearToTest) {
            break;
        }

        if (nextSalaryDate.isSameOrBefore(currentDate, 'day')) {
             console.error("[getSalaryDatesForYear] Loop Error: Calculated date not after current date. Breaking.", { current: currentDate.format(), calculated: nextSalaryDate.format() });
             break;
        }
        // Advance current date to the DAY of the calculated salary, so the next iteration finds the one AFTER that.
        currentDate = nextSalaryDate.clone();
    }
     if (calculationCount >= maxCalculations) console.warn(`[getSalaryDatesForYear] Reached max calculations (${maxCalculations}).`);
    console.log(`\n[getSalaryDatesForYear] Calculation complete for ${yearToTest}. Found ${salaryDates.size} unique dates.`);
    return Array.from(salaryDates).sort();
}


// --- Optional: Local Execution & Startup Log ---
if (require.main === module && !process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.FUNCTION_TARGET && !process.env.FUNCTIONS_SIGNATURE_TYPE) {
    console.log("--- Running in Local Test Mode ---");
    const testYear = 2025;
    const calculatedDates = getSalaryDatesForYear(testYear);
    console.log(`\nCalculated Salary Dates (YYYY-MM-DD) for ${testYear}:\n${calculatedDates.join('\n')}`);

    const testYear2 = 2026;
    const calculatedDates2 = getSalaryDatesForYear(testYear2);
    console.log(`\nCalculated Salary Dates (YYYY-MM-DD) for ${testYear2}:\n${calculatedDates2.join('\n')}`);


    console.log("\n--- Local Test Mode Finished ---");
}

bot.telegram.getMe().then((botInfo) => {
    console.log(`[Startup] Bot @${botInfo.username} initialized.`);
}).catch((err) => {
    console.error("[Startup] CRITICAL ERROR: Failed to connect to Telegram API.", err);
});