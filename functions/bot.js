// index.js

// Dependencies
const { Telegraf } = require('telegraf');
const moment = require('moment-timezone');

// --- Configuration ---
const BOT_TOKEN = process.env.TOKEN;
const KYIV_TZ = 'Europe/Kiev';
const CHAT_ID = '-1001581609986';
const COMMAND_COOLDOWN_MS = 5000; // 5 seconds cooldown per user

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
function easter(year) {
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

function isUkrainianHoliday(date) {
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
        console.error("[adjustDate] Exceeded max adjustments for " + dateToAdjust.format('YYYY-MM-DD'));
        return dateToAdjust; // Return original on excessive failure
    }
    if (adjustments > 0 && !dateToAdjust.isSame(adjustedDate, 'day')) {
        console.log(`[adjustDate] ${dateToAdjust.format('YYYY-MM-DD')} adjusted to ${adjustedDate.format('YYYY-MM-DD')}`);
    }
    return adjustedDate;
}

// CORRECTED function to determine the NEXT salary date
function getNextSalaryDate(currentDate) {
    console.log('[getNextSalaryDate] Input:', currentDate.format('YYYY-MM-DD HH:mm Z'));
    const salaryTime = { hour: 12, minute: 10, second: 0, millisecond: 0 };
    const currentYear = currentDate.year();

    // Handle specific 2025 override FIRST
    if ((currentDate.year() === 2024 && currentDate.month() === 11 && currentDate.date() >= 27) ||
        (currentDate.year() === 2025 && currentDate.month() === 0))
    {
        let nextSalaryBase = moment.tz([2025, 1, 5], KYIV_TZ); // Base: Feb 5, 2025
        console.log('[getNextSalaryDate] Special case -> Feb 5, 2025');
        let nextSalaryAdjusted = adjustForWeekendHoliday(nextSalaryBase, KYIV_TZ);
        nextSalaryAdjusted.set(salaryTime); // Set time AFTER adjustment
        console.log('[getNextSalaryDate] Final (special):', nextSalaryAdjusted.format('YYYY-MM-DD HH:mm Z'));
        return nextSalaryAdjusted;
    }

    // Define all potential TARGET salary dates (before adjustment)
    const targetDates = [];
    for (let yearOffset = 0; yearOffset <= 1; yearOffset++) { // Check current and next year
        const year = currentYear + yearOffset;
        targetDates.push(moment.tz([year, 1, 5], KYIV_TZ));  // Feb 5
        targetDates.push(moment.tz([year, 2, 5], KYIV_TZ));  // Mar 5
        targetDates.push(moment.tz([year, 3], KYIV_TZ).endOf('month')); // Apr EOM
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

    // Find the first target date strictly after the current date's day
    targetDates.sort((a, b) => a.valueOf() - b.valueOf());
    let nextSalaryTarget = null;
    for (const targetDate of targetDates) {
        if (targetDate.isAfter(currentDate, 'day')) {
            nextSalaryTarget = targetDate.clone();
            console.log(`[getNextSalaryDate] Next target (raw): ${nextSalaryTarget.format('YYYY-MM-DD')}`);
            break;
        }
    }

    if (!nextSalaryTarget) {
        console.error("[getNextSalaryDate] FATAL: No next date found!");
        return moment().add(10, 'years'); // Return error date
    }

    // Apply Weekend/Holiday Adjustment
    let nextSalaryAdjusted = adjustForWeekendHoliday(nextSalaryTarget, KYIV_TZ);

    // Set the specific time AFTER adjustments
    nextSalaryAdjusted.set(salaryTime);

    console.log('[getNextSalaryDate] Final:', nextSalaryAdjusted.format('YYYY-MM-DD HH:mm Z'));
    return nextSalaryAdjusted;
}


// --- Message Formatting ---
// (Restored original style + requested label change)
function getSalaryMessage(now, nextSalary) {
    // Basic validation
    if (!moment.isMoment(now) || !moment.isMoment(nextSalary)) {
        console.error("[getSalaryMessage] Invalid input.");
        return "Error calculating time difference.";
    }

    // Check if today is salary day
    if (now.isSame(nextSalary, 'day')) {
         return "🎉🎊 It's Salary Day! 💰💸 Enjoy your well-earned money! 🥳🍾";
    }

    // Calculate difference
    const difference = nextSalary.diff(now);
    if (difference < 0) {
        console.warn(`[getSalaryMessage] Past date calculated: ${nextSalary.format()}`);
         return `🤔 Calculation error.`;
    }

    const duration = moment.duration(difference);
    const days = Math.floor(duration.asDays());
    const hours = duration.hours();
    const minutes = duration.minutes();
    const seconds = duration.seconds();

    // Original formatting logic based on days remaining
    if (days === 0) {
        return `⏰ Only ${hours}h ${minutes}m ${seconds}s left until Salary Day! 💰 Get ready to celebrate! 🎉`;
    } else if (days === 1) {
        return `⏰ Only 1 day and ${hours}h ${minutes}m left until Salary Day! 💰 Get ready to celebrate! 🎉`;
    } else if (days === 2) {
        return "🗓 2 days to go until Salary Day! 💼 The wait is almost over! 😊";
    } else if (days === 3) {
        return "📅 3 days remaining until Salary Day! 💰 It's getting closer! 🙌";
    } else {
        const countdownText = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        // *** Corrected label "Next salary:" ***
        const nextSalaryText = `Next salary: ${nextSalary.format('MMMM D, YYYY')}`;
        return `⏳ Time until next salary: ${countdownText}\n📆 ${nextSalaryText}`;
    }
}


// --- Bot Event Handlers ---
bot.on('message', async (ctx) => {
    const chatInfo = ctx.chat;
    const userInfo = ctx.from;
    const messageText = ctx.message?.text;
    const nowMs = Date.now();

    console.log(`\n--- [Msg] Chat: ${chatInfo.id} (${chatInfo.type}) | User: ${userInfo.id} (${userInfo.username||'?'}) | Text: "${messageText || '[Non-text]'}" ---`);

    if (messageText) {
        const botUsername = ctx.botInfo?.username;
        const commandMatches = messageText === '/when_salary' || (botUsername && messageText === `/when_salary@${botUsername}`);

        if (commandMatches) {
            const userId = userInfo.id;
            const lastTime = userLastCommandTime[userId] || 0;

            // Cooldown check
            if (nowMs - lastTime < COMMAND_COOLDOWN_MS) {
                console.log(`[Cooldown] User ${userId} blocked.`);
                return; // Stop processing
            }
            userLastCommandTime[userId] = nowMs; // Update last command time

            console.log(`[Handler] Command from User ${userId} in chat ${chatInfo.id}`);
            const calculationStart = moment().tz(KYIV_TZ);
            try {
                const nextSalary = getNextSalaryDate(calculationStart.clone());
                const message = getSalaryMessage(calculationStart, nextSalary);
                console.log(`[Handler] Replying to ${userId}`);
                await ctx.reply(message);
                console.log(`[Handler] Reply OK.`);
            } catch (e) {
                 console.error(`[Handler] Error for ${userId}:`, e);
                 try {
                    // Avoid replying with error if cooldown was the reason
                    if (!(nowMs - lastTime < COMMAND_COOLDOWN_MS)) {
                         await ctx.reply("Sorry, an error occurred.");
                    }
                 } catch (e2) {
                     console.error(`[Handler] Fail reply err:`, e2);
                 }
            }
        }
    }
});

// --- Notification Function ---
async function sendDailyNotification(targetChatId) {
    const now = moment().tz(KYIV_TZ);
    console.log(`[Notify] Gen for ${targetChatId} at`, now.format());
    try {
        const nextSalary = getNextSalaryDate(now.clone());
        const message = getSalaryMessage(now, nextSalary);
        console.log('[Notify] Msg:', message);
        await bot.telegram.sendMessage(targetChatId, message);
        console.log('[Notify] Sent OK to:', targetChatId);
        return true;
    } catch (e) {
        console.error(`[Notify] Fail send to ${targetChatId}:`, e);
        if (e.response?.error_code === 403) {
            console.error(`[Notify] Blocked/kicked from ${targetChatId}?`);
        } else if (e.response?.error_code === 400 && e.response?.description.includes("chat not found")) {
            console.error(`[Notify] Chat ${targetChatId} not found.`);
        }
        return false;
    }
}

// --- Serverless Function Handler (Corrected returns for GitHub Actions) ---
exports.handler = async (event, context) => {
    const startTime = Date.now();
    const invocationId = context?.awsRequestId || `local-${startTime}`;
    console.log(`[Handler ${invocationId}] Start ${new Date(startTime).toISOString()}`);
    try {
        let requestBody = null;
        // Basic Event Parsing
        if (event.body && typeof event.body === 'string') {
             try { requestBody = JSON.parse(event.body); } catch (e) { console.error(`[Handler ${invocationId}] JSON err:`, e); return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
        } else if (event.update_id) { requestBody = event;
        } else if (event.trigger === 'daily_notification' || event.source === 'aws.events' || event['detail-type']) { requestBody = { trigger: 'daily_notification' };
        } else { requestBody = {}; }

        console.log(`[Handler ${invocationId}] Type: ${requestBody.trigger ? 'Notify' : (requestBody.update_id ? 'Update' : 'Unknown')}`);

        // Process based on requestBody
        if (requestBody.trigger === 'daily_notification') {
            const now = moment().tz(KYIV_TZ);
            const today = now.format('YYYY-MM-DD');
            if (lastNotificationDate !== today) {
                console.log(`[Handler ${invocationId}] Send daily for ${today} (Last: ${lastNotificationDate || 'N/A'})`);
                const success = await sendDailyNotification(CHAT_ID);
                if (success) {
                    lastNotificationDate = today; console.log(`[Handler ${invocationId}] Daily OK.`);
                    // Return expected success message for GitHub Actions
                    return { statusCode: 200, body: JSON.stringify({ message: 'Daily notification sent successfully' }) };
                } else {
                    console.error(`[Handler ${invocationId}] Daily Fail.`);
                    // Return 500 for actual send failures
                    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send daily notification' }) };
                }
            } else {
                console.log(`[Handler ${invocationId}] Daily skip (${today}).`);
                // Return expected skip message for GitHub Actions
                return { statusCode: 200, body: JSON.stringify({ message: 'Notification already sent today' }) };
            }
        } else if (requestBody.update_id) {
            console.log(`[Handler ${invocationId}] Update ${requestBody.update_id}`);
            if (!bot.botInfo) { try { bot.botInfo = await bot.telegram.getMe(); console.log(`[Handler ${invocationId}] Bot: @${bot.botInfo.username}`); } catch (e) { console.error(`[Handler ${invocationId}] getMe err:`, e); } }
            await bot.handleUpdate(requestBody);
            console.log(`[Handler ${invocationId}] Update OK.`);
            // Standard OK for webhook
            return { statusCode: 200, body: JSON.stringify({ message: 'OK' }) };
        } else {
            console.log(`[Handler ${invocationId}] Unknown req.`);
            return { statusCode: 400, body: JSON.stringify({ error: 'Unrecognized request' }) };
        }
    } catch (e) {
        console.error(`[Handler ${invocationId}] CRITICAL:`, e);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
    } finally {
        console.log(`[Handler ${invocationId}] End. Dur: ${Date.now() - startTime}ms`);
    }
};


// --- Utility Function (for local testing) ---
function getSalaryDatesForYear(yearToTest) {
    console.log(`\n[Test] Salary dates for ${yearToTest}...`);
    let currentDate = moment.tz([yearToTest - 1, 11, 31], KYIV_TZ);
    let salaryDates = new Set();
    let calcCount = 0;
    const maxCalc = 24;
    while (currentDate.year() < yearToTest + 1 && calcCount < maxCalc) {
        calcCount++;
        let nextSalaryDate = getNextSalaryDate(currentDate.clone());
        if (nextSalaryDate.year() >= currentDate.year() + 5) { // Check for error date
            console.error("[Test] Error date from calc."); break;
        }
        if (nextSalaryDate.year() === yearToTest) {
            const fmtDate = nextSalaryDate.format('YYYY-MM-DD'); // Use base date for set
            if (!salaryDates.has(fmtDate)) {
                salaryDates.add(fmtDate);
                console.log(` -> ${nextSalaryDate.format('YYYY-MM-DD dddd, HH:mm')}`); // Log formatted
            }
        } else if (nextSalaryDate.year() > yearToTest) {
            break;
        }
        if (nextSalaryDate.isSameOrBefore(currentDate, 'day')) { // Prevent loops
            console.error("[Test] Loop Error", { cur: currentDate.format(), calc: nextSalaryDate.format() }); break;
        }
        currentDate = nextSalaryDate.clone(); // Advance to the found salary day
    }
    if (calcCount >= maxCalc) console.warn(`[Test] Max calcs.`);
    console.log(`[Test] Found ${salaryDates.size} dates for ${yearToTest}.`);
    return Array.from(salaryDates).sort();
}

// --- Optional: Local Execution & Startup Log ---
if (require.main === module && !process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.FUNCTION_TARGET && !process.env.FUNCTIONS_SIGNATURE_TYPE) {
    console.log("--- Local Test ---");
    const y1 = 2025;
    const d1 = getSalaryDatesForYear(y1);
    console.log(`\nDates ${y1}:\n${d1.join('\n')}`);
    const y2 = 2026;
    const d2 = getSalaryDatesForYear(y2);
    console.log(`\nDates ${y2}:\n${d2.join('\n')}`);
    console.log("\n--- Test End ---");
}

bot.telegram.getMe().then((i) => console.log(`[Startup] OK: @${i.username}`)).catch((e) => console.error("[Startup] CRITICAL FAIL:", e));