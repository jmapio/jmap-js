// -------------------------------------------------------------------------- \\
// File: InfiniteDateSource.js                                                \\
// Module: CalendarModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const ObservableArray = O.ObservableArray;

// ---

const InfiniteDateSource = Class({

    Extends: ObservableArray,

    init: function ( mixin ) {
        InfiniteDateSource.parent.constructor.call( this, null, mixin );
        this.windowLengthDidChange();
    },

    start: new Date(),

    getNext: function ( date ) {
        return new Date( date ).add( 1 );
    },

    getPrev: function ( date ) {
        return new Date( date ).subtract( 1 );
    },

    windowLength: 10,

    windowLengthDidChange: function () {
        var windowLength = this.get( 'windowLength' );
        var length = this.get( 'length' );
        var anchor, array, i;
        if ( length < windowLength ) {
            anchor = this.last();
            array = this._array;
            for ( i = length; i < windowLength; i += 1 ) {
                anchor = anchor ?
                    this.getNext( anchor ) :
                    new Date( this.get( 'start' ) );
                if ( anchor ) {
                    array[i] = anchor;
                } else {
                    windowLength = i;
                    break;
                }
            }
            this.rangeDidChange( length, windowLength );
        }
        this.set( 'length', windowLength );
    }.observes( 'windowLength' ),

    shiftWindow: function ( offset ) {
        var current = this.get( '[]' );
        var length = this.get( 'windowLength' );
        var didShift = false;
        var anchor;
        if ( offset < 0 ) {
            anchor = current[0];
            while ( offset++ ) {
                anchor = this.getPrev( anchor );
                if ( !anchor ) {
                    break;
                }
                didShift = true;
                current.unshift( anchor );
            }
            if ( didShift ) {
                current = current.slice( 0, length );
            }
        } else {
            anchor = current.last();
            while ( offset-- ) {
                anchor = this.getNext( anchor );
                if ( !anchor ) {
                    break;
                }
                didShift = true;
                current.push( anchor );
            }
            if ( didShift ) {
                current = current.slice( -length );
            }
        }
        if ( didShift ) {
            this.set( '[]', current );
        }
        return didShift;
    },
});

// --- Export

JMAP.InfiniteDateSource = InfiniteDateSource;

}( JMAP ) );
