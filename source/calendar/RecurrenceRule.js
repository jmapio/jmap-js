// -------------------------------------------------------------------------- \\
// File: RecurrenceRule.js                                                    \\
// Module: CalendarModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

// --- Filtering ---

var none = 1 << 15;

var getMonth = function ( date, results ) {
    results[0] = date.getUTCMonth();
    results[1] = none;
    results[2] = none;
};
var getDate = function ( date, results, total ) {
    var daysInMonth = total || Date.getDaysInMonth(
            date.getUTCMonth(), date.getUTCFullYear() ) + 1;
    results[0] = date.getUTCDate();
    results[1] = results[0] - daysInMonth;
    results[2] = none;
};
var getDay = function ( date, results ) {
    results[0] = date.getUTCDay();
    results[1] = none;
    results[2] = none;
};
var getDayMonthly = function ( date, results, total ) {
    var day = date.getUTCDay(),
        monthDate = date.getUTCDate(),
        occurrence = Math.floor( ( monthDate - 1 ) / 7 ) + 1,
        daysInMonth = total || Date.getDaysInMonth(
            date.getUTCMonth(), date.getUTCFullYear() ),
        occurrencesInMonth = occurrence +
            Math.floor( ( daysInMonth - monthDate ) / 7 );
    results[0] = day;
    results[1] = day + ( 7 * occurrence );
    results[2] = day + ( 7 * ( occurrence - occurrencesInMonth - 1 ) );
};
var getDayYearly = function ( date, results, daysInYear ) {
    var day = date.getUTCDay(),
        dayOfYear = date.getDayOfYear( true ),
        occurrence = Math.floor( ( dayOfYear - 1 ) / 7 ) + 1,
        occurrencesInYear = occurrence +
            Math.floor( ( daysInYear - dayOfYear ) / 7 );
    results[0] = day;
    results[1] = day + ( 7 * occurrence );
    results[2] = day + ( 7 * ( occurrence - occurrencesInYear - 1 ) );
};
var getYearDay = function ( date, results, total ) {
    results[0] = date.getDayOfYear( true );
    results[1] = results[0] - total;
    results[2] = none;
};
var getWeekNo = function ( firstDayOfWeek, date, results, total ) {
    results[0] = date.getISOWeekNumber( firstDayOfWeek, true );
    results[1] = results[0] - total;
    results[2] = none;
};
var getPosition = function ( date, results, total, index ) {
    results[0] = index + 1;
    results[1] = index - total;
    results[2] = none;
};

var filter = function ( array, getValues, allowedValues, total ) {
    var l = array.length,
        results = [ none, none, none ],
        date, i, ll, a, b, c, allowed;
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
var expand = function ( array, property, values ) {
    var l = array.length, ll = values.length,
        i, j, k = 0,
        results = new Array( l * ll ),
        candidate, newCandidate;
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

var toBoolean = O.Transform.toBoolean;

// ---

var YEARLY = 1;
var MONTHLY = 2;
var WEEKLY = 3;
var DAILY = 4;
var HOURLY = 5;
var MINUTELY = 6;
var SECONDLY = 7;

var frequencyNumbers = {
    yearly: YEARLY,
    monthly: MONTHLY,
    weekly: WEEKLY,
    daily: DAILY,
    hourly: HOURLY,
    minutely: MINUTELY,
    secondly: SECONDLY
};

var dayToNumber = {
    su: 0,
    mo: 1,
    tu: 2,
    we: 3,
    th: 4,
    fr: 5,
    sa: 6
};

var numberToDay = [
    'su',
    'mo',
    'tu',
    'we',
    'th',
    'fr',
    'sa'
];

// ---

var RecurrenceRule = O.Class({

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
        this.byDate = json.byDate || null;
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

        this._isComplexAnchor = false;
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

    // Returns the next set of dates revolving around the interval defined by
    // the fromDate. This may include dates *before* the from date.
    iterate: function ( fromDate, startDate ) {
        var frequency = this.frequency,
            interval = this.interval,

            firstDayOfWeek = this.firstDayOfWeek,

            byDay = this.byDay,
            byDate = this.byDate,
            byMonth = this.byMonth,
            byYearDay = this.byYearDay,
            byWeekNo = this.byWeekNo,

            byHour = this.byHour,
            byMinute = this.byMinute,
            bySecond = this.bySecond,

            bySetPosition = this.bySetPosition,

            candidates = [],
            maxAttempts =
                ( frequency === YEARLY ) ? 10 :
                ( frequency === MONTHLY ) ? 24 :
                ( frequency === WEEKLY ) ? 53 :
                ( frequency === DAILY ) ? 366 :
                ( frequency === HOURLY ) ? 48 :
                /* MINUTELY || SECONDLY */ 120,
            useFastPath, i, daysInMonth, offset, candidate, lastDayInYear,
            weeksInYear, year, month, date, hour, minute, second;

        // Check it's sane.
        if ( interval < 1 ) {
            throw new Error( 'RecurrenceRule: Cannot have interval < 1' );
        }

        // Ignore illegal restrictions:
        if ( frequency !== YEARLY ) {
            byWeekNo = null;
        }
        switch ( frequency ) {
            case WEEKLY:
                byDate = null;
                /* falls through */
            case DAILY:
            case MONTHLY:
                byYearDay = null;
                break;
        }

        // Only fill-in-the-blanks cases not handled by the fast path.
        if ( frequency === YEARLY ) {
            if ( byDate && !byMonth && !byDay && !byYearDay && !byWeekNo ) {
                if ( byDate.length === 1 &&
                        byDate[0] === fromDate.getUTCDate() ) {
                    byDate = null;
                } else {
                    byMonth = [ fromDate.getUTCMonth() ];
                }
            }
            if ( byMonth && !byDate && !byDay && !byYearDay && !byWeekNo ) {
                byDate = [ fromDate.getUTCDate() ];
            }
        }
        if ( frequency === MONTHLY && byMonth && !byDate && !byDay ) {
            byDate = [ fromDate.getUTCDate() ];
        }
        if ( frequency === WEEKLY && byMonth && !byDay ) {
            byDay = [ fromDate.getUTCDay() ];
        }

        // Deal with monthly/yearly repetitions where the anchor may not exist
        // in some cycles. Must not use fast path.
        if ( this._isComplexAnchor &&
                !byDay && !byDate && !byMonth && !byYearDay && !byWeekNo ) {
            byDate = [ startDate.getUTCDate() ];
            if ( frequency === YEARLY ) {
                byMonth = [ startDate.getUTCMonth() ];
            }
        }

        useFastPath = !byDay && !byDate && !byMonth && !byYearDay && !byWeekNo;
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
                if ( byDate ) {
                    filter( candidates, getDate, byDate,
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
                filter( candidates, getPosition, bySetPosition,
                    candidates.length );
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
    },

    // start = Date recurrence starts (should be first occurrence)
    // begin = Beginning of time period to return occurrences within
    // end = End of time period to return occurrences within
    getOccurrences: function ( start, begin, end ) {
        var frequency = this.frequency,
            count = this.count || 0,
            until = this.until,
            results = [],
            interval, year, month, date, isComplexAnchor,
            beginYear, beginMonth,
            anchor, temp, occurrences, occurrence, i, l;

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
        isComplexAnchor = this._isComplexAnchor = date > 28 &&
            ( frequency === MONTHLY || (frequency === YEARLY && month === 1) );

        // Must always iterate from the start if there's a count
        if ( count || begin === start ) {
            // Anchor will be created below if complex
            if ( !isComplexAnchor ) {
                anchor = start;
            }
        } else {
            // Find first anchor before or equal to "begin" date.
            interval = this.interval;
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
                interval *= 7;
                /* falls through */
            case DAILY:
                interval *= 24;
                /* falls through */
            case HOURLY:
                interval *= 60;
                /* falls through */
            case MINUTELY:
                interval *= 60;
                /* falls through */
            case SECONDLY:
                interval *= 1000;
                anchor = new Date( begin - ( ( begin - start ) % interval ) );
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
            temp = this.iterate( anchor, start );
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
    }
});

RecurrenceRule.dayToNumber = dayToNumber;
RecurrenceRule.numberToDay = numberToDay;

RecurrenceRule.fromJSON = function ( recurrenceRuleJSON ) {
    return new RecurrenceRule( recurrenceRuleJSON );
};

JMAP.RecurrenceRule = RecurrenceRule;

}( JMAP ) );
