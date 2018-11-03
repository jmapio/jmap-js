// -------------------------------------------------------------------------- \\
// File: NonEmptyDateSource.js                                                \\
// Module: CalendarModel                                                      \\
// Requires: InfiniteDateSource.js, calendar-model.js                         \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const guid = O.guid;
const Class = O.Class;
const ObservableArray = O.ObservableArray;

const calendar = JMAP.calendar;
const indexObservers = calendar.indexObservers;
const findEventsForDate = calendar.findEventsForDate;
const NO_EVENTS = calendar.NO_EVENTS;
const TIMED_OR_ALL_DAY = calendar.TIMED_OR_ALL_DAY;
const InfiniteDateSource = JMAP.InfiniteDateSource;

// ---

const SlaveEventsList = Class({

    Extends: ObservableArray,

    init: function ( date, source, initialArray ) {
        this.date = date;
        this.source = source;
        source.eventsLists[ guid( this ) ] = this;

        SlaveEventsList.parent.constructor.call( this, initialArray );
    },

    destroy: function () {
        delete this.source.eventsLists[ guid( this ) ];
        SlaveEventsList.parent.destroy.call( this );
    },
});

// ---

const returnTrue = function (/* event */) {
    return true;
};

// ---

const NonEmptyDateSource = Class({

    Extends: InfiniteDateSource,

    init: function () {
        this.where = returnTrue;
        this.index = {};
        this.eventsLists = {};
        this.allDay = TIMED_OR_ALL_DAY;
        NonEmptyDateSource.parent.init.apply( this, arguments );
        indexObservers[ guid( this ) ] = this;
    },

    destroy: function () {
        delete indexObservers[ guid( this ) ];
        NonEmptyDateSource.parent.destroy.call( this );
    },

    getNext: function ( date ) {
        var start = this.get( 'start' );
        var next = this.getDelta( date, 1 );
        if ( date < start && ( !next || next > start ) ) {
            return new Date( start );
        }
        return next;
    },

    getPrev: function ( date ) {
        var start = this.get( 'start' );
        var prev = this.getDelta( date, -1 );
        if ( date > start && ( !prev || prev < start ) ) {
            return new Date( start );
        }
        return prev;
    },

    getDelta: function ( date, deltaDays ) {
        var start = calendar.get( 'loadedEventsStart' );
        var end = calendar.get( 'loadedEventsEnd' );
        var allDay = this.get( 'allDay' );
        var where = this.get( 'where' );
        var events = NO_EVENTS;
        var index = this.index;
        var timestamp;
        date = new Date( date );
        do {
            date = date.add( deltaDays, 'day' );
            // Check we're within our bounds
            if ( date < start || end <= date ) {
                return null;
            }
            timestamp = +date;
            events = index[ timestamp ] ||
                findEventsForDate( date, allDay, where );
            index[ timestamp ] = events;
        } while ( events === NO_EVENTS );

        return date;
    },

    getEventsForDate: function ( date ) {
        var index = this.index;
        var timestamp = +date;
        return new SlaveEventsList( date, this,
            index[ timestamp ] ||
            ( index[ timestamp ] = findEventsForDate(
                date, this.get( 'allDay' ), this.get( 'where' ) ) )
        );
    },

    recalculate: function () {
        var allDay = this.get( 'allDay' );
        var where = this.get( 'where' );
        var start = this.get( 'start' );
        var first = this.first() || start;
        var index = this.index = {};
        var eventsLists = this.eventsLists;
        var id, list, date;
        for ( id in eventsLists ) {
            list = eventsLists[ id ];
            date = list.date;
            list.set( '[]',
                index[ +date ] = findEventsForDate( date, allDay, where )
            );
        }

        this.set( '[]', [
            this.getNext( new Date( first ).add( -1, 'day' ) ) ||
            new Date( start )
        ]).windowLengthDidChange();
    }.observes( 'where' ),
});

// --- Export

JMAP.NonEmptyDateSource = NonEmptyDateSource;

}( JMAP ) );
