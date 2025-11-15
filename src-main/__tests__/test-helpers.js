// Reusable test utilities and data generators for workdays/workhours testing

/**
 * Create a test date for a specific day of week, hour, and minute
 * @param {number} dayOfWeek - 0=Sunday, 1=Monday, ..., 6=Saturday
 * @param {number} hour - 0-23
 * @param {number} minute - 0-59
 * @returns {Date}
 */
function createTestDate(dayOfWeek, hour, minute) {
  const date = new Date();
  const currentDay = date.getDay();
  const daysToAdd = (dayOfWeek - currentDay + 7) % 7;
  date.setDate(date.getDate() + daysToAdd);
  date.setHours(hour, minute, 0, 0);
  return date;
}

/**
 * Create a test date from an ISO string
 * @param {string} dateString - ISO date string (e.g., "2024-01-15T10:30:00")
 * @returns {Date}
 */
function createTestDateFromString(dateString) {
  return new Date(dateString);
}

/**
 * Generate array of test time points for a given period
 * @param {string} start - Start time in "HH:MM" format
 * @param {string} end - End time in "HH:MM" format
 * @param {boolean} spansMidnight - Whether the period spans midnight
 * @returns {Array<{time: Date, label: string}>}
 */
function getTimePoints(start, end, spansMidnight = false) {
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  
  const points = [];
  const baseDate = new Date();
  
  if (spansMidnight) {
    // Before start time (yesterday's period end)
    const beforeStart = new Date(baseDate);
    beforeStart.setHours(startHour, startMinute, 0, 0);
    beforeStart.setDate(beforeStart.getDate() - 1);
    points.push({ time: beforeStart, label: 'before start (yesterday period)' });
    
    // At start time
    const atStart = new Date(baseDate);
    atStart.setHours(startHour, startMinute, 0, 0);
    points.push({ time: atStart, label: 'at start' });
    
    // Mid-period (after start, before midnight)
    const midPeriod = new Date(baseDate);
    midPeriod.setHours(23, 0, 0, 0);
    points.push({ time: midPeriod, label: 'mid-period (before midnight)' });
    
    // Midnight boundary
    const midnight = new Date(baseDate);
    midnight.setHours(0, 0, 0, 0);
    points.push({ time: midnight, label: 'midnight' });
    
    // After midnight, before end
    const afterMidnight = new Date(baseDate);
    afterMidnight.setHours(0, 30, 0, 0);
    points.push({ time: afterMidnight, label: 'after midnight, before end' });
    
    // At end time
    const atEnd = new Date(baseDate);
    atEnd.setHours(endHour, endMinute, 0, 0);
    points.push({ time: atEnd, label: 'at end' });
    
    // After end time
    const afterEnd = new Date(baseDate);
    afterEnd.setHours(endHour + 1, endMinute, 0, 0);
    points.push({ time: afterEnd, label: 'after end' });
  } else {
    // Before start time
    const beforeStart = new Date(baseDate);
    beforeStart.setHours(startHour - 1, startMinute, 0, 0);
    points.push({ time: beforeStart, label: 'before start' });
    
    // At start time
    const atStart = new Date(baseDate);
    atStart.setHours(startHour, startMinute, 0, 0);
    points.push({ time: atStart, label: 'at start' });
    
    // Mid-period
    const midHour = Math.floor((startHour + endHour) / 2);
    const midPeriod = new Date(baseDate);
    midPeriod.setHours(midHour, 30, 0, 0);
    points.push({ time: midPeriod, label: 'mid-period' });
    
    // At end time
    const atEnd = new Date(baseDate);
    atEnd.setHours(endHour, endMinute, 0, 0);
    points.push({ time: atEnd, label: 'at end' });
    
    // After end time
    const afterEnd = new Date(baseDate);
    afterEnd.setHours(endHour + 1, endMinute, 0, 0);
    points.push({ time: afterEnd, label: 'after end' });
  }
  
  return points;
}

/**
 * Get common workday configurations
 * @returns {Array<{days: Array<number>, description: string}>}
 */
function getWorkdayConfigs() {
  return [
    { days: [1, 2, 3, 4, 5], description: 'Mon-Fri' },
    { days: [0, 1, 2, 3, 4, 5, 6], description: 'Every day' },
    { days: [1], description: 'Monday only' },
    { days: [0, 6], description: 'Weekends only' },
    { days: [], description: 'No workdays' },
    { days: [2, 4], description: 'Tue, Thu' }
  ];
}

/**
 * Get workhour configurations
 * @returns {Array<{start: string, end: string, description: string, spansMidnight: boolean}>}
 */
function getWorkhourConfigs() {
  return [
    { start: '09:00', end: '17:00', description: 'Normal 9-5', spansMidnight: false },
    { start: '18:00', end: '01:00', description: 'Spans midnight (6pm-1am)', spansMidnight: true },
    { start: '22:00', end: '06:00', description: 'Spans midnight (10pm-6am)', spansMidnight: true },
    { start: '09:00', end: '09:00', description: 'Equal start/end (24-hour period)', spansMidnight: true },
    { start: '00:00', end: '23:59', description: 'All day', spansMidnight: false },
    { start: '12:00', end: '13:00', description: 'Lunch hour', spansMidnight: false }
  ];
}

/**
 * Create test matrix combining workdays, workhours, and time points
 * @param {Array} workdayConfigs - Array of workday configurations
 * @param {Array} workhourConfigs - Array of workhour configurations
 * @param {Array} timePoints - Array of time points to test
 * @returns {Array<Object>}
 */
function createTestMatrix(workdayConfigs, workhourConfigs, timePoints) {
  const matrix = [];
  
  for (const workday of workdayConfigs) {
    for (const workhour of workhourConfigs) {
      for (const timePoint of timePoints) {
        matrix.push({
          workdays: workday.days,
          workhours: { start: workhour.start, end: workhour.end },
          testTime: timePoint.time,
          timeLabel: timePoint.label,
          workdayDescription: workday.description,
          workhourDescription: workhour.description,
          spansMidnight: workhour.spansMidnight
        });
      }
    }
  }
  
  return matrix;
}

/**
 * Generate scenarios for end < start (midnight-spanning)
 * @returns {Array<Object>}
 */
function generateEndBeforeStartScenarios() {
  const scenarios = [];
  const workdayConfigs = getWorkdayConfigs();
  const midnightSpanningHours = getWorkhourConfigs().filter(c => c.spansMidnight);
  
  for (const workday of workdayConfigs) {
    for (const workhour of midnightSpanningHours) {
      const timePoints = getTimePoints(workhour.start, workhour.end, true);
      
      for (const timePoint of timePoints) {
        // Determine day context
        const dayOfWeek = timePoint.time.getDay();
        const isWorkday = workday.days.includes(dayOfWeek);
        
        let dayContext = 'unknown';
        if (!isWorkday) {
          dayContext = 'non-workday';
        } else if (workday.days.length === 7) {
          dayContext = 'every day workday';
        } else {
          // Check if day before or after workday
          const prevDay = (dayOfWeek - 1 + 7) % 7;
          const nextDay = (dayOfWeek + 1) % 7;
          if (!workday.days.includes(prevDay) && workday.days.includes(dayOfWeek)) {
            dayContext = 'day after workday';
          } else if (workday.days.includes(dayOfWeek) && !workday.days.includes(nextDay)) {
            dayContext = 'day before workday';
          } else {
            dayContext = 'workday';
          }
        }
        
        scenarios.push({
          workdays: workday.days,
          workhours: { start: workhour.start, end: workhour.end },
          testTime: timePoint.time,
          timeLabel: timePoint.label,
          dayContext,
          workdayDescription: workday.description,
          workhourDescription: workhour.description,
          expectedInWorkHours: calculateExpectedInWorkHours(workhour.start, workhour.end, timePoint.time, true),
          expectedIsActive: isWorkday && calculateExpectedInWorkHours(workhour.start, workhour.end, timePoint.time, true)
        });
      }
    }
  }
  
  return scenarios;
}

/**
 * Generate scenarios for end == start
 * @returns {Array<Object>}
 */
function generateEndEqualsStartScenarios() {
  const scenarios = [];
  const workdayConfigs = getWorkdayConfigs();
  const equalHours = getWorkhourConfigs().filter(c => c.start === c.end);
  
  for (const workday of workdayConfigs) {
    for (const workhour of equalHours) {
      const testTime = createTestDate(1, 9, 0); // Monday 9:00
      const dayOfWeek = testTime.getDay();
      const isWorkday = workday.days.includes(dayOfWeek);
      
      let dayContext = 'unknown';
      if (!isWorkday) {
        dayContext = 'non-workday';
      } else if (workday.days.length === 7) {
        dayContext = 'every day workday';
      } else {
        const prevDay = (dayOfWeek - 1 + 7) % 7;
        const nextDay = (dayOfWeek + 1) % 7;
        if (!workday.days.includes(prevDay) && workday.days.includes(dayOfWeek)) {
          dayContext = 'day after workday';
        } else if (workday.days.includes(dayOfWeek) && !workday.days.includes(nextDay)) {
          dayContext = 'day before workday';
        } else {
          dayContext = 'workday';
        }
      }
      
      // For equal times, only active at exact moment
      const [startHour, startMinute] = workhour.start.split(':').map(Number);
      const atExactTime = testTime.getHours() === startHour && testTime.getMinutes() === startMinute;
      
      scenarios.push({
        workdays: workday.days,
        workhours: { start: workhour.start, end: workhour.end },
        testTime,
        timeLabel: 'at exact start/end time',
        dayContext,
        workdayDescription: workday.description,
        workhourDescription: workhour.description,
        expectedInWorkHours: atExactTime,
        expectedIsActive: isWorkday && atExactTime
      });
    }
  }
  
  return scenarios;
}

/**
 * Generate scenarios for end > start (normal case)
 * @returns {Array<Object>}
 */
function generateEndAfterStartScenarios() {
  const scenarios = [];
  const workdayConfigs = getWorkdayConfigs();
  const normalHours = getWorkhourConfigs().filter(c => !c.spansMidnight && c.start !== c.end);
  
  for (const workday of workdayConfigs) {
    for (const workhour of normalHours) {
      const timePoints = getTimePoints(workhour.start, workhour.end, false);
      
      for (const timePoint of timePoints) {
        const dayOfWeek = timePoint.time.getDay();
        const isWorkday = workday.days.includes(dayOfWeek);
        
        let dayContext = 'unknown';
        if (!isWorkday) {
          dayContext = 'non-workday';
        } else if (workday.days.length === 7) {
          dayContext = 'every day workday';
        } else {
          const prevDay = (dayOfWeek - 1 + 7) % 7;
          const nextDay = (dayOfWeek + 1) % 7;
          if (!workday.days.includes(prevDay) && workday.days.includes(dayOfWeek)) {
            dayContext = 'day after workday';
          } else if (workday.days.includes(dayOfWeek) && !workday.days.includes(nextDay)) {
            dayContext = 'day before workday';
          } else {
            dayContext = 'workday';
          }
        }
        
        scenarios.push({
          workdays: workday.days,
          workhours: { start: workhour.start, end: workhour.end },
          testTime: timePoint.time,
          timeLabel: timePoint.label,
          dayContext,
          workdayDescription: workday.description,
          workhourDescription: workhour.description,
          expectedInWorkHours: calculateExpectedInWorkHours(workhour.start, workhour.end, timePoint.time, false),
          expectedIsActive: isWorkday && calculateExpectedInWorkHours(workhour.start, workhour.end, timePoint.time, false)
        });
      }
    }
  }
  
  return scenarios;
}

/**
 * Generate day context scenarios (non-workday, day before, day after, every day)
 * @returns {Array<Object>}
 */
function generateDayContextScenarios() {
  const scenarios = [];
  const workdayConfigs = getWorkdayConfigs();
  const workhourConfigs = getWorkhourConfigs();
  
  for (const workday of workdayConfigs) {
    for (const workhour of workhourConfigs) {
      // Test on a non-workday
      if (workday.days.length > 0 && workday.days.length < 7) {
        const nonWorkday = findNonWorkday(workday.days);
        const testTime = createTestDate(nonWorkday, 12, 0);
        scenarios.push({
          workdays: workday.days,
          workhours: { start: workhour.start, end: workhour.end },
          testTime,
          dayContext: 'non-workday',
          workdayDescription: workday.description,
          workhourDescription: workhour.description,
          expectedIsActive: false
        });
      }
      
      // Test on day after workday
      if (workday.days.length > 0 && workday.days.length < 7) {
        const dayAfter = findDayAfterWorkday(workday.days);
        if (dayAfter !== null) {
          const testTime = createTestDate(dayAfter, 12, 0);
          scenarios.push({
            workdays: workday.days,
            workhours: { start: workhour.start, end: workhour.end },
            testTime,
            dayContext: 'day after workday',
            workdayDescription: workday.description,
            workhourDescription: workhour.description,
            expectedIsActive: false
          });
        }
      }
      
      // Test on day before workday
      if (workday.days.length > 0 && workday.days.length < 7) {
        const dayBefore = findDayBeforeWorkday(workday.days);
        if (dayBefore !== null) {
          const testTime = createTestDate(dayBefore, 12, 0);
          scenarios.push({
            workdays: workday.days,
            workhours: { start: workhour.start, end: workhour.end },
            testTime,
            dayContext: 'day before workday',
            workdayDescription: workday.description,
            workhourDescription: workhour.description,
            expectedIsActive: false
          });
        }
      }
      
      // Test on every day workday
      if (workday.days.length === 7) {
        const testTime = createTestDate(1, 12, 0); // Monday
        scenarios.push({
          workdays: workday.days,
          workhours: { start: workhour.start, end: workhour.end },
          testTime,
          dayContext: 'every day workday',
          workdayDescription: workday.description,
          workhourDescription: workhour.description,
          expectedIsActive: calculateExpectedInWorkHours(workhour.start, workhour.end, testTime, workhour.spansMidnight)
        });
      }
    }
  }
  
  return scenarios;
}

/**
 * Helper: Calculate expected in-work-hours result
 */
function calculateExpectedInWorkHours(start, end, testTime, spansMidnight) {
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  
  const startTime = new Date(testTime);
  startTime.setHours(startHour, startMinute, 0, 0);
  
  const endTime = new Date(testTime);
  endTime.setHours(endHour, endMinute, 0, 0);
  
  if (spansMidnight) {
    if (endTime <= startTime) {
      // Spans midnight (including when start == end, which means 24-hour period)
      if (testTime >= startTime) {
        return true; // After start today
      } else {
        return testTime < endTime; // Before end (yesterday's period)
      }
    }
  } else {
    return testTime >= startTime && testTime < endTime;
  }
  
  return false;
}

/**
 * Helper: Find a non-workday
 */
function findNonWorkday(workdays) {
  for (let i = 0; i < 7; i++) {
    if (!workdays.includes(i)) {
      return i;
    }
  }
  return null;
}

/**
 * Helper: Find day after workday
 */
function findDayAfterWorkday(workdays) {
  for (let i = 0; i < 7; i++) {
    if (workdays.includes(i)) {
      const nextDay = (i + 1) % 7;
      if (!workdays.includes(nextDay)) {
        return nextDay;
      }
    }
  }
  return null;
}

/**
 * Helper: Find day before workday
 */
function findDayBeforeWorkday(workdays) {
  for (let i = 0; i < 7; i++) {
    if (workdays.includes(i)) {
      const prevDay = (i - 1 + 7) % 7;
      if (!workdays.includes(prevDay)) {
        return prevDay;
      }
    }
  }
  return null;
}

module.exports = {
  createTestDate,
  createTestDateFromString,
  getWorkdayConfigs,
  createTestMatrix,
  generateEndBeforeStartScenarios,
  generateEndEqualsStartScenarios,
  generateEndAfterStartScenarios,
  generateDayContextScenarios
};

