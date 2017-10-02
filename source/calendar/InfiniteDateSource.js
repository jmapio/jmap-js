// -------------------------------------------------------------------------- \\
// File: InfiniteDateSource.js                                                \\
// Module: CalendarModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

var InfiniteDateSource = O.Class({

    Extends: O.ObservableArray,

    init: function ( mixin ) {
        InfiniteDateSource.parent.init.call( this, null, mixin );
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
        var windowLength = this.get( 'windowLength' ),
            length = this.get( 'length' ),
            anchor, array, i;
        if ( length < windowLength ) {
            anchor = this.last();
            array = this._array;
            for ( i = length; i < windowLength; i += 1 ) {
                array[i] = anchor = anchor ?
                    this.getNext( anchor ) : this.get( 'start' );
            }
            this.rangeDidChange( length, windowLength );
        }
        this.set( 'length', windowLength );
    }.observes( 'windowLength' ),

    shiftWindow: function ( offset ) {
        var current = this._array.slice(),
            length = this.get( 'windowLength' ),
            anchor;
        if ( offset < 0 ) {
            anchor = current[0];
            while ( offset++ ) {
                anchor = this.getPrev( anchor );
                current.unshift( anchor );
            }
            current = current.slice( 0, length );
        } else {
            anchor = current.last();
            while ( offset-- ) {
                anchor = this.getNext( anchor );
                current.push( anchor );
            }
            current = current.slice( -length );
        }
        this.set( '[]', current );
    }
});

JMAP.InfiniteDateSource = InfiniteDateSource;

}( JMAP ) );
