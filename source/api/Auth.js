// -------------------------------------------------------------------------- \\
// File: Auth.js                                                              \\
// Module: API                                                                \\
// Requires: SHA-256, namespace.js                                            \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP, JSON, jsSHA */

'use strict';

( function ( JMAP ) {

var base64encode = function ( object ) {
    return btoa( JSON.stringify( object ) );
};

var b64tob64url = function ( string ) {
    return string
        .replace( /\=/g, '' )
        .replace( /\+/g, '-' )
        .replace( /\//g, '_' );
};

var b64urltob64 = function ( string ) {
    return string
        .replace( /\-/g, '+' )
        .replace( /\_/g, '/' );
};

// ---

JMAP.auth = new O.Object({

    isAuthenticated: false,

    username: '',
    accessToken: '',
    signingId: '',
    signingKey: '',

    accounts: {},
    capabilities: {},

    authenticationUrl: '',
    apiUrl: '',
    downloadUrl: '',
    uploadUrl: '',
    eventSourceUrl: '',

    _isFetchingEndPoints: false,

    defaultAccountId: function () {
        var accounts = this.get( 'accounts' );
        var id;
        for ( id in accounts ) {
            if ( accounts[ id ].isPrimary ) {
                return id;
            }
        }
        return null;
    }.property( 'accounts' ),

    // ---

    signUrl: function ( url ) {
        var header = b64tob64url( base64encode({
            alg: 'HS256',
            typ: 'JWT'
        }));
        var payload = b64tob64url( base64encode({
            iss: this.get( 'signingId' ),
            sub: url.replace( /[?#].*/, '' ),
            iat: Math.floor( Date.now() / 1000 )
        }));
        var token = header + '.' + payload;
        var signingKey = this.get( 'signingKey' );
        var signature = signingKey ?
            '.' + b64tob64url(
                new jsSHA( 'SHA-256', 'TEXT' )
                    .setHMACKey( b64urltob64( signingKey ), 'B64' )
                    .update( token )
                    .getHMAC( 'B64' )
            ) :
            '';
        return url +
            ( url.contains( '?' ) ? '&' : '?' ) +
            'access_token=' + token + signature;
    },

    getUrlForBlob: function ( accountId, blobId, name ) {
        if ( !accountId ) {
            accountId = this.get( 'defaultAccountId' );
        }
        return this.signUrl(
            this.get( 'downloadUrl' )
                .replace( '{accountId}', encodeURIComponent( accountId ) )
                .replace( '{blobId}', encodeURIComponent( blobId ) )
                .replace( '{name}', encodeURIComponent( name || '' ) )
        );
    },

    blobUrlRegExp: function () {
        return new RegExp( '^' +
            this.get( 'downloadUrl' ).escapeRegExp()
                .replace( '{accountId}'.escapeRegExp(), '.*?' )
                .replace( '{blobId}'.escapeRegExp(), '(.*?)' )
                .replace( '{name}'.escapeRegExp(), '.*?' )
        );
    }.property( 'proxyUrl' ),

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
                'Authorization': 'Bearer ' + auth.get( 'accessToken' )
            },
            withCredentials: true,
            responseType: 'json',
            success: function ( event ) {
                auth.didAuthenticate( event.data );
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
        if ( !isAuthenticated || this._isFetchingEndPoints ) {
            this._awaitingAuthentication.include( connection );
        }
        return false;
    },

    connectionSucceeded: function () {
        if ( this.get( 'isDisconnected' ) ) {
            this._timeToWait = 1;
            this.set( 'isDisconnected', false );
        }
    },

    connectionFailed: function ( connection, timeToWait ) {
        if ( this.get( 'isAuthenticated' ) ) {
            this._failedConnections.include( connection );
            this.retryIn( timeToWait );
        } else {
            this._awaitingAuthentication.include( connection );
        }
    },

    retryIn: function ( timeToWait ) {
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
