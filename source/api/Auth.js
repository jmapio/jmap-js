// -------------------------------------------------------------------------- \\
// File: Auth.js                                                              \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP, JSON */

"use strict";

( function ( JMAP ) {

JMAP.auth = new O.Object({

    isAuthenticated: false,

    username: '',
    accessToken: '',

    authenticationUrl: '',
    apiUrl: '',
    eventSourceUrl: '',
    uploadUrl: '',
    downloadUrl: '',

    _isFetchingEndPoints: false,

    // ---

    getUrlForBlob: function ( blobId, name ) {
        return this.get( 'downloadUrl' )
            .replace( '{blobId}', encodeURIComponent( blobId ) )
            .replace( '{name}', encodeURIComponent( name ) );
    },

    // ---

    didAuthenticate: function ( data ) {
        for ( var property in data ) {
            if ( property in this && typeof this[ property ] !== 'function' ) {
                this.set( property, data[ property ] );
            }
        }
        this.set( 'isAuthenticated', !!data.accessToken );

        this._awaitingAuthentication.forEach( function ( connection ) {
            connection.send();
        });
        this._awaitingAuthentication.length = 0;

        return this;
    },

    refindEndpoints: function () {
        if ( this._isFetchingEndPoints || !this.get( 'isAuthenticated' ) ) {
            return this;
        }
        this._isFetchingEndPoints = true;

        var auth = this;
        new O.HttpRequest({
            timeout: 45000,
            method: 'GET',
            url: this.get( 'authenticationUrl' ),
            headers: {
                'Authorization': this.get( 'accessToken' )
            },
            success: function ( event ) {
                auth.didAuthenticate( JSON.parse( event.data ) );
            }.on( 'io:success' ),
            failure: function ( event ) {
                switch ( event.status ) {
                case 403: // Unauthorized
                    auth.didLoseAuthentication();
                    break;
                case 404: // Not Found
                    // Notify user?
                    break;
                case 500: // Internal Server Error
                    // Notify user?
                    break;
                case 503: // Service Unavailable
                    this.retry();
                }
            }.on( 'io:failure' ),
            retry: function () {
                O.RunLoop.invokeAfterDelay( auth.refindEndpoints, 30000, auth );
            }.on( 'io:abort' ),
            cleanup: function () {
                this.destroy();
                auth._isFetchingEndPoints = false;
            }.on( 'io:end' )
        }).send();

        return this;
    },

    didLoseAuthentication: function () {
        return this.set( 'isAuthenticated', false );
    },

    // ---

    isDisconnected: false,
    timeToReconnect: 0,

    _awaitingAuthentication: [],
    _failedConnections: [],

    _timeToWait: 1,
    _timer: null,

    connectionWillSend: function ( connection ) {
        var isAuthenticated = this.get( 'isAuthenticated' );
        if ( isAuthenticated &&
                !this._failedConnections.contains( connection ) ) {
            return true;
        }
        if ( !isAuthenticated ) {
            this._awaitingAuthentication.include( connection );
        }
        return false;
    },

    connectionFailed: function ( connection, timeToWait ) {
        this._failedConnections.include( connection );
        // If we're not already ticking down...
        if ( !this.get( 'timeToReconnect' ) ) {
            // Is this a reconnection attempt already? Exponentially back off.
            timeToWait = this.get( 'isDisconnected' ) ?
                Math.min( this._timeToWait * 2, 300 ) :
                timeToWait || 1;

            this.set( 'isDisconnected', true )
                .set( 'timeToReconnect', timeToWait + 1 );

            this._timeToWait = timeToWait;
            this._timer =
                O.RunLoop.invokePeriodically( this._tick, 1000, this );
            this._tick();
        }
    },

    connectionSucceeded: function () {
        if ( this.get( 'isDisconnected' ) ) {
            this._timeToWait = 1;
            this.set( 'isDisconnected', false );
        }
    },

    _tick: function () {
        var timeToReconnect = this.get( 'timeToReconnect' ) - 1;
        this.set( 'timeToReconnect', timeToReconnect );
        if ( !timeToReconnect ) {
            this.retryConnections();
        }
    },

    retryConnections: function () {
        var failedConnections = this._failedConnections;
        O.RunLoop.cancel( this._timer );
        this.set( 'timeToReconnect', 0 );
        this._timer = null;
        this._failedConnections = [];
        failedConnections.forEach( function ( connection ) {
            connection.send();
        });
    }
});

}( JMAP ) );
