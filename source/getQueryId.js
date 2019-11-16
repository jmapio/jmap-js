// -------------------------------------------------------------------------- \\
// File: getQueryId.js                                                        \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP )  {

const guid = O.guid;

// ---

const stringifySorted = function ( item ) {
    if ( !item || ( typeof item !== 'object' ) ) {
        return JSON.stringify( item );
    }
    if ( item instanceof Array ) {
        return '[' + item.map( stringifySorted ).join( ',' ) + ']';
    }
    var keys = Object.keys( item );
    keys.sort();
    return '{' + keys.map( function ( key ) {
        return '"' + key + '":' + stringifySorted( item[ key ] );
    }).join( ',' ) + '}';
};

const getQueryId = function ( Type, args ) {
    return guid( Type ) + ':' + (
        ( args.accountId || '' ) +
        stringifySorted( args.where || args.filter || null ) +
        stringifySorted( args.sort || null )
    ).hash().toString();
};

// --- Export

JMAP.getQueryId = getQueryId;

}( JMAP ) );
