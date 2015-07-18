// -------------------------------------------------------------------------- \\
// File: Sequence.js                                                          \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. All rights reserved.                \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP ) {

var noop = function () {};

var Sequence = O.Class({

    Extends: O.Object,

    init: function () {
        this.queue = [];
        this.index = 0;
        this.length = 0;
        this.afterwards = noop;

        Sequence.parent.init.call( this );
    },

    then: function ( fn ) {
        this.queue.push( fn );
        this.increment( 'length', 1 );
        return this;
    },

    go: function go ( data ) {
        var index = this.index,
            length = this.length,
            fn = this.queue[ index ];
        if ( index < length ) {
            index += 1;
            this.set( 'index', index );
            fn( go.bind( this ), data );
            if ( index === length ) {
                this.afterwards( index, length );
            }
        }
    },

    cancel: function () {
        var index = this.index,
            length = this.length;
        if ( index < length ) {
            this.set( 'length', 0 );
            this.afterwards( index, length );
        }
    },

    progress: function () {
        var index = this.index,
            length = this.length;
        return length ? Math.round( ( index / length ) * 100 ) : 100;
    }.property( 'index', 'length' )
});

JMAP.Sequence = Sequence;

}( JMAP ) );
