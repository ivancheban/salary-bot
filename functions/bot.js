// index.js (or your main file name)

// Dependencies
const { Telegraf } = require('telegraf');
const moment = require('moment-timezone');

// --- Configuration ---
const BOT_TOKEN = process.env.TOKEN; // Make sure TOKEN is set in your environment
const KYIV_TZ = 'Europe/Kiev';
const CHAT_ID = '-1001581609986'; // Your target group chat ID

// --- Basic Startup Check ---
if (!BOT_TOKEN) {
    console.error("FATAL ERROR: Bot token not provided in environment variable 'TOKEN'");
    // In a serverless environment, throwing an error might be better than exiting
    throw new Error("Bot token not provided in environment variable 'TOKEN'");
    // process.exit(1); // Use exit(1) only if running as a standalone process
}

const bot = new Telegraf(BOT_TOKEN);

// --- State ---
// WARNING: This state variable works reliably only if the environment is stateful
// (e.g., a long-running process). In standard stateless serverless environments
// (like AWS Lambda), this variable might reset on each invocation. This could
// lead to multiple notifications if the trigger fires more than once per day
// or if multiple instances run. Use an external store (DB, cache) for robust
// duplicate prevention in stateless setups.
let lastNotificationDate = null;

// --- Date/Holiday Functions ---

function easter(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
    const e = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - d - (c % 4)) % 7;
    const f = d + e - 7 * Math.floor((a + 11 * d + 22 * e) / 451) + 114;
    const month = Math.floor(f / 31);
    const day = (f % 31) + 1;
    // Note: month is 1-based from calculation, moment expects 0-based month index
    return moment.tz([year, month - 1, day], KYIV_TZ);
}

function isUkrainianHoliday(date) {
    const year = date.year();
    const month = date.month() + 1; // moment month is 0-based
    const day = date.date();

    // Fixed holidays (Month, Day)
    const fixedHolidays = [
        [1, 1],   // New Year's Day
        [1, 7],   // Orthodox Christmas
        [3, 8],   // International Women's Day
        [5, 1],   // International Workers' Day
        [5, 9],   // Victory Day over Nazism in World War II
        [6, 28],  // Constitution Day
        [8, 24],  // Independence Day
        [10, 14], // Defenders Day (check if still valid, legislation changes)
        [12, 25], // Christmas Day (Gregorian)
        // Add potential new holidays like Statehood Day (July 28th or July 15th depending on year/legislation)
        // [7, 28] // Example: Ukrainian Statehood Day - Verify current official date
    ];

    if (fixedHolidays.some(([m, d]) => month === m && day === d)) {
        console.log(`[isUkrainianHoliday] ${date.format('YYYY-MM-DD')} is a fixed holiday.`);
        return true;
    }

    // Calculate dynamic holidays (relative to Orthodox Easter)
    const easterDate = easter(year);
    // Note: Easter calculation might need validation for specific edge cases or calendar reforms.
    // The provided calculation is a common algorithm for Orthodox Easter (Julian calendar based for Pascha).
    const trinityDate = easterDate.clone().add(49, 'days'); // Pentecost/Trinity Sunday

    // Check against dynamic holidays
    // Note: Only Trinity Sunday itself is typically a non-working day, not Easter Monday in Ukraine recently. Verify current law.
    // Easter itself is always a Sunday, so handled by weekend check.
    if (date.isSame(trinityDate, 'day')) {
         console.log(`[isUkrainianHoliday] ${date.format('YYYY-MM-DD')} is Trinity Sunday.`);
         return true;
    }
    // If Easter Monday is needed:
    // const easterMondayDate = easterDate.clone().add(1, 'day');
    // if (date.isSame(easterMondayDate, 'day')) {
    //     console.log(`[isUkrainianHoliday] ${date.format('YYYY-MM-DD')} is Easter Monday.`);
    //     return true;
    // }


    return false;
}

// --- Salary Calculation Logic ---

function getNextSalaryDate(currentDate) {
    console.log('[getNextSalaryDate] Calculating for input date:', currentDate.format('YYYY-MM-DD HH:mm:ss Z'));
    const salaryTime = { hour: 12, minute: 10, second: 0, millisecond: 0 };
    let nextSalary; // This will be a moment object

    const currentYear = currentDate.year();
    const currentMonth = currentDate.month(); // 0-indexed (0=Jan, 11=Dec)
    const currentDayOfMonth = currentDate.date();

    // --- Special Cases 2024/2025 ---
    // Note: >= 27 ensures that even if run *on* Dec 27th, it calculates for Feb 5th.
    if (currentYear === 2024 && currentMonth === 11 && currentDayOfMonth >= 27) {
        nextSalary = moment.tz([2025, 1, 5], KYIV_TZ); // Target: Feb 5, 2025
        console.log('[getNextSalaryDate] Special case: Late Dec 2024 -> Feb 5, 2025');
    } else if (currentYear === 2025 && currentMonth === 0) { // All of January 2025
        nextSalary = moment.tz([2025, 1, 5], KYIV_TZ); // Target: Feb 5, 2025
        console.log('[getNextSalaryDate] Special case: Jan 2025 -> Feb 5, 2025');
    } else {
        // --- Regular Logic ---
        const isLastMonthOfQuarter = currentMonth % 3 === 2; // Mar (2), Jun (5), Sep (8), Dec (11)
        const isFirstMonthOfQuarter = currentMonth % 3 === 0; // Jan (0), Apr (3), Jul (6), Oct (9)
        // Middle months are Feb (1), May (4), Aug (7), Nov (10)

        let targetMonth = currentMonth;
        let targetDay = 5; // Default target day

        if (isLastMonthOfQuarter) {
             // Mar, Jun, Sep, Dec
            if (currentDayOfMonth <= 5) {
                 // Paid on 5th of this month
                targetDay = 5;
                targetMonth = currentMonth;
                console.log(`[getNextSalaryDate] Last month of Q (${currentMonth + 1}), before/on 5th -> Target: ${targetMonth + 1}-05`);
            } else {
                 // Paid at end of quarter (last day of month)
                targetMonth = currentMonth; // Stay in the same month
                nextSalary = currentDate.clone().endOf('month'); // Calculate end of month directly
                console.log(`[getNextSalaryDate] Last month of Q (${currentMonth + 1}), after 5th -> Target: End of Month ${nextSalary.format('YYYY-MM-DD')}`);
                // Skip setting targetDay/targetMonth as nextSalary is already set
            }
        } else if (isFirstMonthOfQuarter) {
            // Jan, Apr, Jul, Oct
             // Salary is always on the 5th of the *next* month
            targetDay = 5;
            targetMonth = currentMonth + 1; // Move to next month
            console.log(`[getNextSalaryDate] First month of Q (${currentMonth + 1}) -> Target: ${targetMonth + 1}-05`);
        } else {
            // Middle month: Feb, May, Aug, Nov
            if (currentDayOfMonth <= 5) {
                 // Paid on 5th of this month
                targetDay = 5;
                targetMonth = currentMonth;
                console.log(`[getNextSalaryDate] Middle month of Q (${currentMonth + 1}), before/on 5th -> Target: ${targetMonth + 1}-05`);
            } else {
                 // Paid on 5th of *next* month
                targetDay = 5;
                targetMonth = currentMonth + 1; // Move to next month
                console.log(`[getNextSalaryDate] Middle month of Q (${currentMonth + 1}), after 5th -> Target: ${targetMonth + 1}-05`);
            }
        }

        // If nextSalary wasn't set directly (end of quarter case), calculate it now
        if (!nextSalary) {
             // Handle year rollover if targetMonth becomes 12 or more
            let targetYear = currentYear;
            if (targetMonth >= 12) {
                targetYear += Math.floor(targetMonth / 12);
                targetMonth = targetMonth % 12;
            }
             // Use moment constructor carefully with potentially adjusted year/month
            nextSalary = moment.tz([targetYear, targetMonth, targetDay], KYIV_TZ);
            console.log(`[getNextSalaryDate] Calculated initial target date: ${nextSalary.format('YYYY-MM-DD')}`);
        }

        // --- Final Adjustments ---

        // Exception: If calculation resulted in Dec 31, 2024, move to Dec 30, 2024
        // This specifically handles the end-of-quarter case for Dec
        if (nextSalary.year() === 2024 && nextSalary.month() === 11 && nextSalary.date() === 31) {
            nextSalary = moment.tz([2024, 11, 30], KYIV_TZ); // Dec 30, 2024
            console.log('[getNextSalaryDate] Adjustment: Dec 31, 2024 -> Dec 30, 2024');
        }
    } // End of regular logic block


    // --- Weekend/Holiday Adjustment ---
    // Move *backwards* from the target date if it falls on a weekend or holiday
    let adjustments = 0;
    const maxAdjustments = 7; // Safety break
    while (adjustments < maxAdjustments) {
         // Check weekend (Saturday=6, Sunday=0)
        const dayOfWeek = nextSalary.day();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            console.log(`[getNextSalaryDate] Adjusting ${nextSalary.format('YYYY-MM-DD')} (Weekend: ${nextSalary.format('dddd')}) -> Subtract 1 day`);
            nextSalary.subtract(1, 'day');
            adjustments++;
            continue; // Re-check the new date
        }
         // Check holiday
        if (isUkrainianHoliday(nextSalary)) {
             console.log(`[getNextSalaryDate] Adjusting ${nextSalary.format('YYYY-MM-DD')} (Holiday) -> Subtract 1 day`);
            nextSalary.subtract(1, 'day');
            adjustments++;
            continue; // Re-check the new date
        }
         // If it's not a weekend or holiday, we're done adjusting
        break;
    }
     if (adjustments >= maxAdjustments) {
          console.error("[getNextSalaryDate] Exceeded maximum holiday/weekend adjustments. Check logic or holiday data.");
          // Potentially return the unadjusted date or throw an error
     }


    // Set the specific time (12:10 PM)
    nextSalary.set(salaryTime);

    console.log('[getNextSalaryDate] Final next salary date:', nextSalary.format('YYYY-MM-DD HH:mm:ss Z'));
    return nextSalary;
}


function getSalaryMessage(now, nextSalary) {
    // Ensure 'now' and 'nextSalary' are moment objects
    if (!moment.isMoment(now) || !moment.isMoment(nextSalary)) {
        console.error("[getSalaryMessage] Invalid input: 'now' or 'nextSalary' is not a moment object.");
        return "Error calculating time difference.";
    }

    // Log input times for debugging
    // console.log(`[getSalaryMessage] Now: ${now.format()}, Next Salary: ${nextSalary.format()}`);

    // Check if salary day is today (ignoring time)
    if (now.isSame(nextSalary, 'day')) {
        // Optional: Check if salary time has passed
        if (now.isSameOrAfter(nextSalary)) {
             return "🎉🎊 Salary has arrived! 💰💸 Check your accounts! 🥳🍾";
        } else {
             // It's salary day, but the time hasn't hit yet
             const differenceToday = nextSalary.diff(now);
             const durationToday = moment.duration(differenceToday);
             const hoursToday = Math.floor(durationToday.asHours()); // Use asHours for total hours
             const minutesToday = durationToday.minutes();
             const secondsToday = durationToday.seconds();
              return `🎉 It's Salary Day! Just ${hoursToday}h ${minutesToday}m ${secondsToday}s left until 12:10 PM! 💰`;
        }
    }

    // Calculate difference if it's not today
    const difference = nextSalary.diff(now);

    // Check if salary date is somehow in the past (shouldn't happen with correct getNextSalaryDate)
    if (difference < 0) {
        console.warn(`[getSalaryMessage] Calculated next salary date (${nextSalary.format()}) is in the past relative to now (${now.format()}). Check calculation logic.`);
         // Provide a generic message or recalculate?
         return `🤔 Calculating next salary... The date seems to be in the past. Please check again shortly or contact admin.`;
    }

    const duration = moment.duration(difference);

    // Extract components
    const days = Math.floor(duration.asDays()); // Total days
    const hours = duration.hours(); // Hours component (0-23)
    const minutes = duration.minutes(); // Minutes component (0-59)
    const seconds = duration.seconds(); // Seconds component (0-59)

    // Format the message based on remaining time
    if (days === 0) {
        // Less than 1 day left
        return `⏰ Almost there! Only ${hours}h ${minutes}m ${seconds}s left until Salary Day! 💰 Get ready! 🎉`;
    } else if (days === 1) {
        return `⏰ Just 1 day, ${hours}h ${minutes}m left until Salary Day! 💰 The final countdown! 🎉`;
    } else if (days === 2) {
        return `🗓️ 2 days to go until Salary Day! 💼 Keep up the great work! 😊`;
    } else if (days === 3) {
        return `📅 3 days remaining until Salary Day! 💰 Planning time! 🙌`;
    } else {
        // More than 3 days left
        const countdownText = `${days}d ${hours}h ${minutes}m ${seconds}s`; // Include seconds for more dynamic feel
        const nextSalaryText = `Next Salary: ${nextSalary.format('dddd, MMMM D, YYYY')} at ${nextSalary.format('HH:mm')}`; // More specific date/time
        return `⏳ Time until next salary: ${countdownText}\n📆 ${nextSalaryText}`;
    }
}

// --- Bot Event Handlers ---

// Listener for ANY message to debug group interaction
bot.on('message', async (ctx) => {
    // **Enhanced Logging for Debugging Group Chats**
    // Log essential info for EVERY message the bot receives.
    const chatInfo = ctx.chat;
    const userInfo = ctx.from;
    const messageText = ctx.message?.text; // Use optional chaining for non-text messages

    console.log(`\n--- [Message Received] ---`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Chat ID: ${chatInfo.id} | Chat Type: ${chatInfo.type}`);
    if (chatInfo.title) {
        console.log(`Chat Title: ${chatInfo.title}`);
    }
    console.log(`User ID: ${userInfo.id} | Username: @${userInfo.username || 'N/A'} | Name: ${userInfo.first_name} ${userInfo.last_name || ''}`);
    console.log(`Message Text: "${messageText || '[Non-text message]'}"`);
    console.log(`Bot Info: @${ctx.botInfo?.username || 'N/A'}`); // Log the bot's own username
    console.log(`--------------------------\n`);


    // Only proceed if it's a text message
    if (messageText) {
        const botUsername = ctx.botInfo?.username; // Get the bot's username

        // Check if the command matches /when_salary or /when_salary@YourBotUsername
        const commandMatches = messageText === '/when_salary' || (botUsername && messageText === `/when_salary@${botUsername}`);

        if (commandMatches) {
            console.log(`[Message Handler] Command /when_salary detected in chat ${chatInfo.id}`);
            const now = moment().tz(KYIV_TZ);
            console.log('[Message Handler] Current date:', now.format('YYYY-MM-DD HH:mm:ss Z'));

            try {
                const nextSalary = getNextSalaryDate(now.clone()); // Use clone to avoid mutation
                const message = getSalaryMessage(now, nextSalary);

                console.log('[Message Handler] Replying with message:', message);
                await ctx.reply(message, {
                    // Optional: Helps avoid accidental notification spam if user sends command rapidly
                    // reply_to_message_id: ctx.message.message_id
                });
                console.log(`[Message Handler] Replied successfully in chat ${chatInfo.id}`);

            } catch (calculationError) {
                 console.error(`[Message Handler] Error calculating salary or message in chat ${chatInfo.id}:`, calculationError);
                 try {
                     await ctx.reply("Sorry, I encountered an error while calculating the salary date. Please try again later or contact the administrator.");
                 } catch (errorReplyError) {
                     console.error(`[Message Handler] Failed to send error reply in chat ${chatInfo.id}:`, errorReplyError);
                 }
            }

        } else {
            // Optional: Log that a message was received but didn't match the command
            // console.log(`[Message Handler] Ignored non-command text message in chat ${chatInfo.id}`);
        }
    } else {
        // Optional: Log that a non-text message was received
        // console.log(`[Message Handler] Ignored non-text message in chat ${chatInfo.id}`);
    }
});

// --- Notification Function ---

async function sendDailyNotification(targetChatId) {
    const now = moment().tz(KYIV_TZ);
    console.log(`[Notification] Generating notification for chat ${targetChatId} at Kyiv time:`, now.format());

    try {
        const nextSalary = getNextSalaryDate(now.clone()); // Use clone
        const message = getSalaryMessage(now, nextSalary);
        console.log('[Notification] Notification message:', message);

        await bot.telegram.sendMessage(targetChatId, message);
        console.log('[Notification] Daily notification sent successfully to chat:', targetChatId);
        return true; // Indicate success

    } catch (error) {
        console.error(`[Notification] Failed to send daily notification to chat ${targetChatId}:`, error);
        // Check for specific errors (e.g., bot blocked, chat not found)
        if (error.response && error.response.error_code === 403) {
             console.error(`[Notification] Bot might be blocked or kicked from chat ${targetChatId}.`);
        } else if (error.response && error.response.error_code === 400 && error.response.description.includes("chat not found")) {
             console.error(`[Notification] Chat ${targetChatId} not found.`);
        }
        return false; // Indicate failure
    }
}

// --- Serverless Function Handler (e.g., AWS Lambda, Google Cloud Function) ---

exports.handler = async (event, context) => {
    const startTime = Date.now();
    // context.awsRequestId is specific to AWS Lambda, use a generic timestamp or check context if needed
    const invocationId = context?.awsRequestId || `local-${startTime}`;
    console.log(`[Handler - ${invocationId}] Function started at: ${new Date(startTime).toISOString()}`);
    console.log(`[Handler - ${invocationId}] Received event:`, JSON.stringify(event, null, 2));

    try {
        let requestBody = null;

        // Detect common triggers (API Gateway, direct Lambda invoke, EventBridge)
        if (event.body && typeof event.body === 'string') {
            // Likely API Gateway or similar HTTP trigger
            console.log(`[Handler - ${invocationId}] Processing event with string body (likely API Gateway)`);
            try {
                requestBody = JSON.parse(event.body);
                console.log(`[Handler - ${invocationId}] Parsed body:`, JSON.stringify(requestBody, null, 2));
            } catch (parseError) {
                 console.error(`[Handler - ${invocationId}] Failed to parse event body JSON:`, parseError);
                 return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
            }
        } else if (event.update_id) {
            // Likely a direct Telegram update object (less common for webhooks but possible)
             console.log(`[Handler - ${invocationId}] Processing direct Telegram update object`);
            requestBody = event;
        } else if (event.source === 'aws.events' || event['detail-type']) {
            // Likely EventBridge scheduled event
             console.log(`[Handler - ${invocationId}] Processing EventBridge event`);
             // Check detail for specific trigger info if needed
             if (event.detail?.trigger === 'daily_notification' || event['detail-type'] === 'Scheduled Event') { // Adapt check as needed
                 requestBody = { trigger: 'daily_notification' };
             } else {
                 console.log(`[Handler - ${invocationId}] Unrecognized EventBridge detail/type.`);
                 requestBody = event.detail || {}; // Pass detail if exists
             }
        } else if (event.trigger === 'daily_notification') {
             // Direct invocation with a simple trigger object
              console.log(`[Handler - ${invocationId}] Processing direct invocation trigger`);
             requestBody = event;
        } else {
             console.log(`[Handler - ${invocationId}] Unrecognized event structure. Assuming body is the event itself or empty.`);
             requestBody = event || {}; // Use event if it's an object, or empty object
        }


        // --- Process based on requestBody ---

        // 1. Daily Notification Trigger
        if (requestBody.trigger === 'daily_notification') {
            console.log(`[Handler - ${invocationId}] Daily notification trigger identified.`);
            const now = moment().tz(KYIV_TZ);
            const today = now.format('YYYY-MM-DD');

            // Check state variable (see warning about statelessness)
            if (lastNotificationDate !== today) {
                console.log(`[Handler - ${invocationId}] Sending daily notification for date: ${today} (Last sent: ${lastNotificationDate || 'Never'})`);
                const success = await sendDailyNotification(CHAT_ID);
                if (success) {
                    lastNotificationDate = today; // Mark as sent *for this invocation*
                    console.log(`[Handler - ${invocationId}] Daily notification successful. lastNotificationDate updated to ${lastNotificationDate}.`);
                    return { statusCode: 200, body: JSON.stringify({ message: 'Daily notification sent successfully' }) };
                } else {
                    console.error(`[Handler - ${invocationId}] Daily notification failed.`);
                    // Do not update lastNotificationDate on failure
                    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send daily notification' }) };
                }
            } else {
                console.log(`[Handler - ${invocationId}] Notification already processed today (${today}), skipping. Current lastNotificationDate: ${lastNotificationDate}`);
                return { statusCode: 200, body: JSON.stringify({ message: 'Notification already processed today' }) };
            }
        }

        // 2. Telegram Update (Webhook)
        // Check for update_id, a reliable indicator of a Telegram update object
        else if (requestBody.update_id) {
            console.log(`[Handler - ${invocationId}] Handling Telegram update (update_id: ${requestBody.update_id})`);
            // Initialize Telegraf with bot info if not already done implicitly
             if (!bot.botInfo) {
                 try {
                     bot.botInfo = await bot.telegram.getMe();
                     console.log(`[Handler - ${invocationId}] Fetched bot info: @${bot.botInfo.username}`);
                 } catch (getMeError) {
                     console.error(`[Handler - ${invocationId}] Failed to fetch bot info:`, getMeError);
                     // Proceed without botInfo, command matching with @mention might fail
                 }
             }
            // Let Telegraf process the update object
            await bot.handleUpdate(requestBody);
            console.log(`[Handler - ${invocationId}] Telegram update processed by Telegraf.`);
            // Telegram generally expects a 200 OK response quickly for webhooks
            return { statusCode: 200, body: JSON.stringify({ message: 'OK' }) };
        }

        // 3. Unrecognized Request
        else {
            console.log(`[Handler - ${invocationId}] Unrecognized request payload.`);
            return { statusCode: 400, body: JSON.stringify({ error: 'Unrecognized request format or trigger', receivedPayload: requestBody }) };
        }

    } catch (e) {
        console.error(`[Handler - ${invocationId}] Critical error processing event:`, e);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error', details: e.message })
        };
    } finally {
        const duration = Date.now() - startTime;
        console.log(`[Handler - ${invocationId}] Function finished. Duration: ${duration}ms`);
    }
};

// --- Utility Function (for local testing/debugging salary dates) ---
function getSalaryDatesForYear(yearToTest) {
    console.log(`\n[getSalaryDatesForYear] Calculating expected salary dates for ${yearToTest}...`);
    // Start from the last day of the previous year to ensure the first calculation catches the earliest date in the target year
    let currentDate = moment.tz([yearToTest - 1, 11, 31], KYIV_TZ);
    let salaryDates = new Set(); // Use a Set to automatically handle potential duplicates
    let calculationCount = 0;
    const maxCalculations = 24; // Safety limit

    while (currentDate.year() < yearToTest + 1 && calculationCount < maxCalculations) {
        calculationCount++;
        console.log(`\n[getSalaryDatesForYear Iteration ${calculationCount}]`);
        let nextSalaryDate = getNextSalaryDate(currentDate.clone()); // Use clone

        if (nextSalaryDate.year() === yearToTest) {
            const formattedDate = nextSalaryDate.format('YYYY-MM-DD');
             if (!salaryDates.has(formattedDate)) {
                 salaryDates.add(formattedDate);
                 console.log(`[getSalaryDatesForYear] Found ${yearToTest} salary date: ${formattedDate} (${nextSalaryDate.format('dddd')})`);
             }
        } else if (nextSalaryDate.year() > yearToTest) {
             console.log(`[getSalaryDatesForYear] Calculated date ${nextSalaryDate.format('YYYY-MM-DD')} is beyond ${yearToTest}, stopping.`);
            break; // Stop if we calculate a date in the following year
        } else {
             console.log(`[getSalaryDatesForYear] Calculated date ${nextSalaryDate.format('YYYY-MM-DD')} is before ${yearToTest}, continuing.`);
        }

        // Advance current date to the day *after* the calculated salary date to find the *next* one
        // Ensure we don't get stuck if calculation is wrong
        if (nextSalaryDate.isSameOrBefore(currentDate)) {
             console.error("[getSalaryDatesForYear] Calculated salary date is not after the current date! Potential infinite loop. Breaking.", {
                 current: currentDate.format(),
                 calculated: nextSalaryDate.format()
             });
             break;
        }
        currentDate = nextSalaryDate.clone().add(1, 'day');
    }

    if (calculationCount >= maxCalculations) {
        console.warn(`[getSalaryDatesForYear] Reached maximum calculation limit (${maxCalculations}). Check logic for infinite loops or unexpected date sequences.`);
    }

    console.log(`\n[getSalaryDatesForYear] Calculation complete for ${yearToTest}. Found ${salaryDates.size} unique dates.`);
    return Array.from(salaryDates).sort(); // Return sorted array
}

// --- Optional: Local Execution Block ---
// This block will only run if the script is executed directly (e.g., `node index.js`)
// and NOT when deployed as a serverless function (where process.env.AWS_LAMBDA_FUNCTION_NAME exists etc.)
// Useful for local testing of date calculations.
if (require.main === module && !process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.FUNCTION_TARGET && !process.env.FUNCTIONS_SIGNATURE_TYPE) {
    console.log("--- Running in Local Test Mode ---");

    // Test salary date calculation for a specific year
    const testYear = 2025;
    const calculatedDates = getSalaryDatesForYear(testYear);
    console.log(`\nCalculated Salary Dates for ${testYear}:`);
    calculatedDates.forEach(date => console.log(date));

    // You could add code here to run the bot using polling for local development
    // if needed, but the primary design is for webhook/serverless.
    // Example (requires bot.launch()):
    // console.log("\nStarting bot locally using polling...");
    // bot.launch().then(() => {
    //    console.log("Bot polling started.");
    // }).catch(err => {
    //    console.error("Failed to launch bot polling:", err);
    // });
    // // Graceful shutdown
    // process.once('SIGINT', () => bot.stop('SIGINT'));
    // process.once('SIGTERM', () => bot.stop('SIGTERM'));

    console.log("\n--- Local Test Mode Finished ---");
}

// Log bot username after initialization (helps confirm token is working)
bot.telegram.getMe().then((botInfo) => {
    console.log(`[Startup] Bot initialized successfully. Username: @${botInfo.username} (ID: ${botInfo.id})`);
}).catch((err) => {
    // This is critical - if getMe fails, the token is likely wrong or network is down
    console.error("[Startup] CRITICAL ERROR: Failed to connect to Telegram API with the provided token.", err);
});