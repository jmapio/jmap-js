// -------------------------------------------------------------------------- \\
// File: RecurrenceRule.js                                                    \\
// Module: CalendarModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const toBoolean = O.Transform.toBoolean;
const Class = O.Class;

// ---

const YEARLY = 1;
const MONTHLY = 2;
const WEEKLY = 3;
const DAILY = 4;
const HOURLY = 5;
const MINUTELY = 6;
const SECONDLY = 7;

const frequencyNumbers = {
    yearly: YEARLY,
    monthly: MONTHLY,
    weekly: WEEKLY,
    daily: DAILY,
    hourly: HOURLY,
    minutely: MINUTELY,
    secondly: SECONDLY,
};

const dayToNumber = {
    su: 0,
    mo: 1,
    tu: 2,
    we: 3,
    th: 4,
    fr: 5,
    sa: 6,
};

const numberToDay = [
    'su',
    'mo',
    'tu',
    'we',
    'th',
    'fr',
    'sa',
];

// ---

const none = 1 << 15;

const getMonth = function ( date, results ) {
    results[0] = date.getUTCMonth();
    results[1] = none;
    results[2] = none;
};

const getDate = function ( date, results, total ) {
    var daysInMonth = total || Date.getDaysInMonth(
            date.getUTCMonth(), date.getUTCFullYear() ) + 1;
    results[0] = date.getUTCDate();
    results[1] = results[0] - daysInMonth;
    results[2] = none;
};

const getDay = function ( date, results ) {
    results[0] = date.getUTCDay();
    results[1] = none;
    results[2] = none;
};

const getDayMonthly = function ( date, results, total ) {
    var day = date.getUTCDay();
    var monthDate = date.getUTCDate();
    var occurrence = Math.floor( ( monthDate - 1 ) / 7 ) + 1;
    var daysInMonth = total || Date.getDaysInMonth(
            date.getUTCMonth(), date.getUTCFullYear() );
    var occurrencesInMonth = occurrence +
            Math.floor( ( daysInMonth - monthDate ) / 7 );
    results[0] = day;
    results[1] = day + ( 7 * occurrence );
    results[2] = day + ( 7 * ( occurrence - occurrencesInMonth - 1 ) );
};

const getDayYearly = function ( date, results, daysInYear ) {
    var day = date.getUTCDay();
    var dayOfYear = date.getDayOfYear( true );
    var occurrence = Math.floor( ( dayOfYear - 1 ) / 7 ) + 1;
    var occurrencesInYear = occurrence +
            Math.floor( ( daysInYear - dayOfYear ) / 7 );
    results[0] = day;
    results[1] = day + ( 7 * occurrence );
    results[2] = day + ( 7 * ( occurrence - occurrencesInYear - 1 ) );
};

const getYearDay = function ( date, results, total ) {
    results[0] = date.getDayOfYear( true );
    results[1] = results[0] - total;
    results[2] = none;
};

const getWeekNo = function ( firstDayOfWeek, date, results, total ) {
    results[0] = date.getISOWeekNumber( firstDayOfWeek, true );
    results[1] = results[0] - total;
    results[2] = none;
};

const getPosition = function ( date, results, total, index ) {
    results[0] = index + 1;
    results[1] = index - total;
    results[2] = none;
};

const filter = function ( array, getValues, allowedValues, total ) {
    var l = array.length;
    var results = [ none, none, none ];
    var date, i, ll, a, b, c, allowed;
    ll = allowedValues.length;
    outer: while ( l-- ) {
        date = array[l];
        if ( date ) {
            getValues( date, results, total, l );
            a = results[0];
            b = results[1];
            c = results[2];
            for ( i = 0; i < ll; i += 1 ) {
                allowed = allowedValues[i];
                if ( allowed === a || allowed === b || allowed === c ) {
                    continue outer;
                }
            }
            array[l] = null;
        }
    }
};

const expand = function ( array, property, values ) {
    var l = array.length, ll = values.length;
    var i, j, k = 0;
    var results = new Array( l * ll );
    var candidate, newCandidate;
    for ( i = 0; i < l; i += 1 ) {
        candidate = array[i];
        for ( j = 0; j < ll; j += 1 ) {
            if ( candidate ) {
                newCandidate = new Date( candidate );
                newCandidate[ property ]( values[j] );
            } else {
                newCandidate = null;
            }
            results[ k ] = newCandidate;
            k += 1;
        }
    }
    return results;
};

// Returns the next set of dates revolving around the interval defined by
// the fromDate. This may include dates *before* the from date.
const iterate = function ( fromDate,
        frequency, interval, firstDayOfWeek,
        byDay, byMonthDay, byMonth, byYearDay, byWeekNo,
        byHour, byMinute, bySecond, bySetPosition ) {

    var candidates = [];
    var maxAttempts =
        ( frequency === YEARLY ) ? 10 :
        ( frequency === MONTHLY ) ? 24 :
        ( frequency === WEEKLY ) ? 53 :
        ( frequency === DAILY ) ? 366 :
        ( frequency === HOURLY ) ? 48 :
        /* MINUTELY || SECONDLY */ 120;
    var useFastPath =
        !byDay && !byMonthDay && !byMonth && !byYearDay && !byWeekNo;

    var year, month, date, hour, minute, second;
    var i, daysInMonth, offset, candidate, lastDayInYear, weeksInYear;

    switch ( frequency ) {
        case SECONDLY:
            useFastPath = useFastPath && !bySecond;
            /* falls through */
        case MINUTELY:
            useFastPath = useFastPath && !byMinute;
            /* falls through */
        case HOURLY:
            useFastPath = useFastPath && !byHour;
            break;
    }

    // It's possible to write rules which don't actually match anything.
    // Limit the maximum number of cycles we are willing to pass through
    // looking for a new candidate.
    while ( maxAttempts-- ) {
        year = fromDate.getUTCFullYear();
        month = fromDate.getUTCMonth();
        date = fromDate.getUTCDate();
        hour = fromDate.getUTCHours();
        minute = fromDate.getUTCMinutes();
        second = fromDate.getUTCSeconds();

        // Fast path
        if ( useFastPath ) {
            candidates.push( fromDate );
        } else {
            // 1. Build set of candidates.
            switch ( frequency ) {
            // We do the filtering of bySecond/byMinute/byHour in the
            // candidate generation phase for SECONDLY, MINUTELY and HOURLY
            // frequencies.
            case SECONDLY:
                if ( bySecond && bySecond.indexOf( second ) < 0 ) {
                    break;
                }
                /* falls through */
            case MINUTELY:
                if ( byMinute && byMinute.indexOf( minute ) < 0 ) {
                    break;
                }
                /* falls through */
            case HOURLY:
                if ( byHour && byHour.indexOf( hour ) < 0 ) {
                    break;
                }
                lastDayInYear = new Date( Date.UTC(
                    year, 11, 31, hour, minute, second
                ));
                /* falls through */
            case DAILY:
                candidates.push( new Date( Date.UTC(
                    year, month, date, hour, minute, second
                )));
                break;
            case WEEKLY:
                offset = ( fromDate.getUTCDay() - firstDayOfWeek ).mod( 7 );
                for ( i = 0; i < 7; i += 1 ) {
                    candidates.push( new Date( Date.UTC(
                        year, month, date - offset + i, hour, minute, second
                    )));
                }
                break;
            case MONTHLY:
                daysInMonth = Date.getDaysInMonth( month, year );
                for ( i = 1; i <= daysInMonth; i += 1 ) {
                    candidates.push( new Date( Date.UTC(
                        year, month, i, hour, minute, second
                    )));
                }
                break;
            case YEARLY:
                candidate = new Date( Date.UTC(
                    year, 0, 1, hour, minute, second
                ));
                lastDayInYear = new Date( Date.UTC(
                    year, 11, 31, hour, minute, second
                ));
                while ( candidate <= lastDayInYear ) {
                    candidates.push( candidate );
                    candidate = new Date( +candidate + 86400000 );
                }
                break;
            }

            // 2. Apply restrictions and expansions
            if ( byMonth ) {
                filter( candidates, getMonth, byMonth );
            }
            if ( byMonthDay ) {
                filter( candidates, getDate, byMonthDay,
                    daysInMonth ? daysInMonth + 1 : 0
                );
            }
            if ( byDay ) {
                if ( frequency !== MONTHLY &&
                        ( frequency !== YEARLY || byWeekNo ) ) {
                    filter( candidates, getDay, byDay );
                } else if ( frequency === MONTHLY || byMonth ) {
                    // Filter candidates using position of day in month
                    filter( candidates, getDayMonthly, byDay,
                        daysInMonth || 0 );
                } else {
                    // Filter candidates using position of day in year
                    filter( candidates, getDayYearly, byDay,
                        Date.getDaysInYear( year ) );
                }
            }
            if ( byYearDay ) {
                filter( candidates, getYearDay, byYearDay,
                    lastDayInYear.getDayOfYear( true ) + 1
                );
            }
            if ( byWeekNo ) {
                weeksInYear =
                    lastDayInYear.getISOWeekNumber( firstDayOfWeek, true );
                if ( weeksInYear === 1 ) {
                    weeksInYear = 52;
                }
                filter( candidates, getWeekNo.bind( null, firstDayOfWeek ),
                    byWeekNo,
                    weeksInYear + 1
                );
            }
        }
        if ( byHour && frequency !== HOURLY &&
                frequency !== MINUTELY && frequency !== SECONDLY ) {
            candidates = expand( candidates, 'setUTCHours', byHour );
        }
        if ( byMinute &&
                frequency !== MINUTELY && frequency !== SECONDLY ) {
            candidates = expand( candidates, 'setUTCMinutes', byMinute );
        }
        if ( bySecond && frequency !== SECONDLY ) {
            candidates = expand( candidates, 'setUTCSeconds', bySecond );
        }
        if ( bySetPosition ) {
            candidates = candidates.filter( toBoolean );
            filter( candidates, getPosition, bySetPosition, candidates.length );
        }

        // 3. Increment anchor by frequency/interval
        fromDate = new Date( Date.UTC(
            ( frequency === YEARLY ) ? year + interval : year,
            ( frequency === MONTHLY ) ? month + interval : month,
            ( frequency === WEEKLY ) ? date + 7 * interval :
            ( frequency === DAILY ) ? date + interval : date,
            ( frequency === HOURLY ) ? hour + interval : hour,
            ( frequency === MINUTELY ) ? minute + interval : minute,
            ( frequency === SECONDLY ) ? second + interval : second
        ));

        // 4. Do we have any candidates left?
        candidates = candidates.filter( toBoolean );
        if ( candidates.length ) {
            return [ candidates, fromDate ];
        }
    }
    return [ null, fromDate ];
};

// ---

const RecurrenceRule = Class({

    init: function ( json ) {
        this.frequency = frequencyNumbers[ json.frequency ] || DAILY;
        this.interval = json.interval || 1;

        var firstDayOfWeek = dayToNumber[ json.firstDayOfWeek ];
        this.firstDayOfWeek =
            0 <= firstDayOfWeek && firstDayOfWeek < 7 ? firstDayOfWeek : 1;
        // Convert { day: "monday", nthOfPeriod: -1 } to -6 etc.
        this.byDay = json.byDay ? json.byDay.map( function ( nDay ) {
            return dayToNumber[ nDay.day ] + 7 * ( nDay.nthOfPeriod || 0 );
        }) : null;
        this.byMonthDay = json.byMonthDay || null;
        // Convert "1" (Jan), "2" (Feb) etc. to 0 (Jan), 1 (Feb)
        this.byMonth = json.byMonth ? json.byMonth.map( function ( month ) {
            return parseInt( month, 10 ) - 1;
        }) : null;
        this.byYearDay = json.byYearDay || null;
        this.byWeekNo = json.byWeekNo || null;

        this.byHour = json.byHour || null;
        this.byMinute = json.byMinute || null;
        this.bySecond = json.bySecond || null;

        this.bySetPosition = json.bySetPosition || null;

        this.until = json.until ? Date.fromJSON( json.until ) : null;
        this.count = json.count || null;
    },

    toJSON: function () {
        var result = {};
        var key, value;
        for ( key in this ) {
            if ( key.charAt( 0 ) === '_' || !this.hasOwnProperty( key ) ) {
                continue;
            }
            value = this[ key ];
            if ( value === null ) {
                continue;
            }
            switch ( key ) {
            case 'frequency':
                value = Object.keyOf( frequencyNumbers, value );
                break;
            case 'interval':
                if ( value === 1 ) {
                    continue;
                }
                break;
            case 'firstDayOfWeek':
                if ( value === 1 ) {
                    continue;
                }
                value = numberToDay[ value ];
                break;
            case 'byDay':
                /* jshint ignore:start */
                value = value.map( function ( day ) {
                    return 0 <= day && day < 7 ? {
                        day: numberToDay[ day ]
                    } : {
                        day: numberToDay[ day.mod( 7 ) ],
                        nthOfPeriod: Math.floor( day / 7 )
                    };
                });
                break;
            case 'byMonth':
                value = value.map( function ( month ) {
                    return ( month + 1 ) + '';
                });
                /* jshint ignore:end */
                break;
            case 'until':
                value = value.toJSON();
                break;
            }
            result[ key ] = value;
        }
        return result;
    },

    // start = Date recurrence starts (should be first occurrence)
    // begin = Beginning of time period to return occurrences within
    // end = End of time period to return occurrences within
    getOccurrences: function ( start, begin, end ) {
        var frequency = this.frequency;
        var count = this.count || 0;
        var until = this.until;
        var interval = this.interval;
        var firstDayOfWeek = this.firstDayOfWeek;
        var byDay = this.byDay;
        var byMonthDay = this.byMonthDay;
        var byMonth = this.byMonth;
        var byYearDay = this.byYearDay;
        var byWeekNo = this.byWeekNo;
        var byHour = this.byHour;
        var byMinute = this.byMinute;
        var bySecond = this.bySecond;
        var bySetPosition = this.bySetPosition;

        var results = [];
        var periodLengthInMS = interval;
        var year, month, date;
        var beginYear, beginMonth;
        var isComplexAnchor, anchor, temp, occurrences, occurrence, i, l;

        // Make sure we have a start date, and make sure it will terminate
        if ( !start ) {
            start = new Date();
        }
        if ( !begin || begin <= start ) {
            begin = start;
        }
        if ( !end && !until && !count ) {
            count = 2;
        }
        if ( until && ( !end || end > until ) ) {
            end = new Date( +until + 1000 );
        }
        if ( end && begin >= end ) {
            return results;
        }

        // An anchor is a date == start + x * (interval * frequency)
        // An anchor may return occurrences earlier than it.
        // Anchor results do not overlap.
        // For monthly/yearly recurrences, we have to generate a "false" anchor
        // and use the slow path if the start date may not exist in some cycles
        // e.g. 31st December repeat monthly -> no 31st in some months.
        year = start.getUTCFullYear();
        month = start.getUTCMonth();
        date = start.getUTCDate();
        isComplexAnchor = date > 28 &&
            ( frequency === MONTHLY || (frequency === YEARLY && month === 1) );

        // Check it's sane.
        if ( interval < 1 ) {
            interval = 1;
        }

        // Ignore illegal restrictions:
        if ( frequency !== YEARLY ) {
            byWeekNo = null;
        }
        switch ( frequency ) {
            case WEEKLY:
                byMonthDay = null;
                /* falls through */
            case DAILY:
            case MONTHLY:
                byYearDay = null;
                break;
        }

        // Only inherit-from-start cases not handled by the fast path.
        if ( frequency === YEARLY && !byYearDay ) {
            if ( !byWeekNo ) {
                if ( byMonthDay && !byMonth ) {
                    if ( !byDay && byMonthDay.length === 1 &&
                            byMonthDay[0] === date ) {
                        // This is actually just a standard FREQ=YEARLY
                        // recurrence expressed inefficiently; put it back on
                        // the fast path
                        byMonthDay = null;
                    } else {
                        byMonth = [ month ];
                    }
                }
                if ( byMonth && !byDay && !byMonthDay ) {
                    byMonthDay = [ date ];
                }
            } else if ( !byDay && !byMonthDay ) {
                byDay = [ start.getUTCDay() ];
            }
        }
        if ( frequency === MONTHLY && byMonth && !byMonthDay && !byDay ) {
            byMonthDay = [ date ];
        }
        if ( frequency === WEEKLY && byMonth && !byDay ) {
            byDay = [ start.getUTCDay() ];
        }

        // Deal with monthly/yearly repetitions where the anchor may not exist
        // in some cycles. Must not use fast path.
        if ( isComplexAnchor &&
                !byDay && !byMonthDay && !byMonth && !byYearDay && !byWeekNo ) {
            byMonthDay = [ date ];
            if ( frequency === YEARLY ) {
                byMonth = [ month ];
            }
        }

        // Must always iterate from the start if there's a count
        if ( count || begin === start ) {
            // Anchor will be created below if complex
            if ( !isComplexAnchor ) {
                anchor = start;
            }
        } else {
            // Find first anchor before or equal to "begin" date.
            switch ( frequency ) {
            case YEARLY:
                // Get year of range begin.
                // Subtract year of start
                // Find remainder modulo interval;
                // Subtract from range begin year so we're on an interval.
                beginYear = begin.getUTCFullYear();
                year = beginYear - ( ( beginYear - year ) % interval );
                break;
            case MONTHLY:
                beginYear = begin.getUTCFullYear();
                beginMonth = begin.getUTCMonth();
                // Get number of months from event start to range begin
                month = 12 * ( beginYear - year ) + ( beginMonth - month );
                // Calculate the first anchor month <= the begin month/year
                month = beginMonth - ( month % interval );
                year = beginYear;
                // Month could be < 0 if anchor is in previous year
                if ( month < 0 ) {
                    year += Math.floor( month / 12 );
                    month = month.mod( 12 );
                }
                break;
            case WEEKLY:
                periodLengthInMS *= 7;
                /* falls through */
            case DAILY:
                periodLengthInMS *= 24;
                /* falls through */
            case HOURLY:
                periodLengthInMS *= 60;
                /* falls through */
            case MINUTELY:
                periodLengthInMS *= 60;
                /* falls through */
            case SECONDLY:
                periodLengthInMS *= 1000;
                anchor = new Date( begin -
                    ( ( begin - start ) % periodLengthInMS ) );
                break;
            }
        }
        if ( !anchor ) {
            anchor = new Date( Date.UTC(
                year, month, isComplexAnchor ? 1 : date,
                start.getUTCHours(),
                start.getUTCMinutes(),
                start.getUTCSeconds()
            ));
        }

        // If anchor <= start, filter out any dates < start
        // Always filter dates for begin <= date < end
        // If we reach the count limit or find a date >= end, we're done.
        // For sanity, set the count limit to be in the bounds [0,2^14], so
        // we don't enter a near-infinite loop

        if ( count <= 0 || count > 16384 ) {
            count = 16384; // 2 ^ 14
        }

        // Start date is always included according to RFC5545, even if it
        // doesn't match the recurrence
        if ( anchor <= start ) {
            results.push( start );
            count -= 1;
            if ( !count ) {
                return results;
            }
        }

        outer: while ( true ) {
            temp = iterate( anchor,
                frequency, interval, firstDayOfWeek,
                byDay, byMonthDay, byMonth, byYearDay, byWeekNo,
                byHour, byMinute, bySecond, bySetPosition );
            occurrences = temp[0];
            if ( !occurrences ) {
                break;
            }
            if ( anchor <= start ) {
                /* jshint ignore:start */
                occurrences = occurrences.filter( function ( date ) {
                    return date > start;
                });
                /* jshint ignore:end */
            }
            anchor = temp[1];
            for ( i = 0, l = occurrences.length; i < l; i += 1 ) {
                occurrence = occurrences[i];
                if ( end && occurrence >= end ) {
                    break outer;
                }
                if ( begin <= occurrence ) {
                    results.push( occurrence );
                }
                count -= 1;
                if ( !count ) {
                    break outer;
                }
            }
        }

        return results;
    },

    matches: function ( start, date ) {
        return !!this.getOccurrences( start, date, new Date( +date + 1000 ) )
                     .length;
    },
});

RecurrenceRule.dayToNumber = dayToNumber;
RecurrenceRule.numberToDay = numberToDay;

RecurrenceRule.YEARLY = YEARLY;
RecurrenceRule.MONTHLY = MONTHLY;
RecurrenceRule.WEEKLY = WEEKLY;
RecurrenceRule.DAILY = DAILY;
RecurrenceRule.HOURLY = HOURLY;
RecurrenceRule.MINUTELY = MINUTELY;
RecurrenceRule.SECONDLY = SECONDLY;

RecurrenceRule.fromJSON = function ( recurrenceRuleJSON ) {
    return new RecurrenceRule( recurrenceRuleJSON );
};

// --- Export

JMAP.RecurrenceRule = RecurrenceRule;

}( JMAP ) );
