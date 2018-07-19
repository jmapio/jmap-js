// -------------------------------------------------------------------------- \\
// File: uuid.js                                                              \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global JMAP */

'use strict';

( function ( JMAP ) {

const create = function () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace( /[xy]/g,
    function ( c ) {
        var r = ( Math.random() * 16 )|0;
        var v = c === 'x' ? r : ( r & 0x3 | 0x8 );
        return v.toString( 16 );
    });
};

const mapFromArray = function ( array ) {
    return array && array.reduce( function ( object, item ) {
        object[ create() ] = item;
        return object;
    }, {} );
};

const uuid = {
    create: create,
    mapFromArray: mapFromArray,
};

// --- Export

JMAP.uuid = uuid;

}( JMAP ) );
