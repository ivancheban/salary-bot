const { Telegraf } = require('telegraf');
const moment = require('moment-timezone');

const bot = new Telegraf(process.env.TOKEN);
const KYIV_TZ = 'Europe/Kiev';
const CHAT_ID = '-1001581609986';

let lastNotificationDate = null;

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
    const fixedHolidays = [
        [1, 1],   // New Year's Day
        [1, 7],   // Orthodox Christmas
        [3, 8],   // International Women's Day
        [5, 1],   // International Workers' Day
        [5, 9],   // Victory Day over Nazism in World War II
        [6, 28],  // Constitution Day
        [8, 24],  // Independence Day
        [10, 14], // Defenders Day
        [12, 25], // Catholic Christmas
    ];

    if (fixedHolidays.some(([month, day]) => date.month() + 1 === month && date.date() === day)) {
        return true;
    }

    const easterDate = easter(date.year());
    const easterMondayDate = easterDate.clone().add(1, 'day');
    const trinityDate = easterDate.clone().add(49, 'days');

    return date.isSame(easterDate, 'day') || 
           date.isSame(easterMondayDate, 'day') || 
           date.isSame(trinityDate, 'day');
}

function getNextSalaryDate(currentDate) {
    console.log('Calculating next salary date for:', currentDate.format('YYYY-MM-DD HH:mm'));
    const salaryTime = { hour: 12, minute: 10 };
    let nextSalary;

    // Determine the current quarter end and next quarter start
    const currentQuarterEnd = currentDate.clone().endOf('quarter');
    const nextQuarterStart = currentQuarterEnd.clone().add(1, 'day').startOf('day');

    console.log('Current quarter end:', currentQuarterEnd.format('YYYY-MM-DD'));
    console.log('Next quarter start:', nextQuarterStart.format('YYYY-MM-DD'));

    // Check if we're in a new month
    if (currentDate.date() > 5) {
        // If we're past the 5th, look at the next month
        nextSalary = currentDate.clone().add(1, 'month').date(5);
        console.log('Past the 5th, next salary initially set to:', nextSalary.format('YYYY-MM-DD'));
    } else {
        // We're in a new month, so the next salary is on the 5th
        nextSalary = currentDate.clone().date(5);
        console.log('Before or on the 5th, next salary initially set to:', nextSalary.format('YYYY-MM-DD'));
    }

    // Adjust for end of quarter scenario
    if (nextSalary.isAfter(currentQuarterEnd)) {
        // If the next regular salary day is in the next quarter,
        // the actual next salary day is the end of the current quarter
        nextSalary = currentQuarterEnd;
        console.log('Adjusted for end of quarter:', nextSalary.format('YYYY-MM-DD'));
    }

    // Adjust for weekends and holidays
    while (nextSalary.day() === 0 || nextSalary.day() === 6 || isUkrainianHoliday(nextSalary)) {
        nextSalary.subtract(1, 'day');
        console.log('Adjusted for weekend/holiday:', nextSalary.format('YYYY-MM-DD'));
    }

    // Set the time to 12:10
    nextSalary.set(salaryTime);

    console.log('Final next salary date:', nextSalary.format('YYYY-MM-DD HH:mm'));
    return nextSalary;
}

function getSalaryMessage(now, nextSalary) {
    if (now.isSame(nextSalary, 'day')) {
        return "🎉🎊 It's Salary Day! 💰💸 Enjoy your well-earned money! 🥳🍾";
    }

    const difference = nextSalary.diff(now);
    const duration = moment.duration(difference);
    const days = Math.floor(duration.asDays());
    const hours = duration.hours();
    const minutes = duration.minutes();
    const seconds = duration.seconds();

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
        const nextSalaryText = `Next Salary: ${nextSalary.format('MMMM D, YYYY')}`;
        return `⏳ Time until next salary: ${countdownText}\n📆 ${nextSalaryText}`;
    }
}

bot.command('when_salary', async (ctx) => {
    const now = moment().tz(KYIV_TZ);
    console.log('Current date:', now.format('YYYY-MM-DD HH:mm'));
    const nextSalary = getNextSalaryDate(now);
    console.log('Next salary date:', nextSalary.format('YYYY-MM-DD HH:mm'));
    const message = getSalaryMessage(now, nextSalary);
    console.log('Message:', message);
    await ctx.reply(message);
});

async function sendDailyNotification() {
    const now = moment().tz(KYIV_TZ);
    console.log('Generating notification for Kyiv time:', now.format());
    const nextSalary = getNextSalaryDate(now);
    const message = getSalaryMessage(now, nextSalary);
    console.log('Notification message:', message);

    try {
        await bot.telegram.sendMessage(CHAT_ID, message);
        console.log('Daily notification sent successfully to chat:', CHAT_ID);
        return true;
    } catch (error) {
        console.error('Failed to send daily notification:', error);
        throw error;
    }
}

exports.handler = async (event) => {
    console.log('Handler function called at:', new Date().toISOString());
    console.log('Event:', JSON.stringify(event));
    try {
        const body = JSON.parse(event.body);
        console.log('Parsed body:', body);

        if (body && body.trigger === 'daily_notification') {
            console.log('Daily notification trigger received');
            const now = moment().tz(KYIV_TZ);
            const today = now.format('YYYY-MM-DD');

            if (lastNotificationDate !== today) {
                console.log('Sending daily notification for date:', today);
                const success = await sendDailyNotification();
                if (success) {
                    lastNotificationDate = today;
                    return { 
                        statusCode: 200, 
                        body: JSON.stringify({ message: 'Daily notification sent successfully' })
                    };
                } else {
                    return { 
                        statusCode: 500, 
                        body: JSON.stringify({ error: 'Failed to send daily notification' })
                    };
                }
            } else {
                console.log('Notification already sent today:', today);
                return { 
                    statusCode: 200, 
                    body: JSON.stringify({ message: 'Notification already sent today' })
                };
            }
        }

        if (body && body.message) {
            console.log('Handling Telegram update');
            await bot.handleUpdate(body);
            return { 
                statusCode: 200, 
                body: JSON.stringify({ message: 'OK' })
            };
        }

        console.log('Unrecognized request');
        return { 
            statusCode: 400, 
            body: JSON.stringify({ error: 'Unrecognized request' })
        };
    } catch (e) {
        console.error('Error in handler:', e);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};