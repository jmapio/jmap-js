// -------------------------------------------------------------------------- \\
// File: calendarEventUploads.js                                              \\
// Module: CalendarModel                                                      \\
// Requires: API                                                              \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. All rights reserved.                \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP, undefined ) {

JMAP.calendar.eventUploads = {

    inProgress: {},
    awaitingSave: {},

    get: function ( event ) {
        var id = event.get( 'storeKey' ),
            isEdit = event.get( 'store' ).isNested,
            files = this.inProgress[ id ];

        return files ? files.filter( function ( file ) {
            return isEdit ? file.inEdit : file.inServer;
        }) : [];
    },

    add: function ( event, file ) {
        var id = event.get( 'storeKey' ),
            files = this.inProgress[ id ] || ( this.inProgress[ id ] = [] );
        files.push( file );
        event.computedPropertyDidChange( 'files' );
    },

    remove: function ( event, file ) {
        var id = event.get( 'storeKey' ),
            isEdit = event.get( 'store' ).isNested,
            files = this.inProgress[ id ];

        if ( isEdit && file.inServer ) {
            file.inEdit = false;
        } else {
            files.erase( file );
            if ( !files.length ) {
                delete this.inProgress[ id ];
            }
            file.destroy();
        }
        event.computedPropertyDidChange( 'files' );
    },

    finishEdit: function ( event, source, destination ) {
        var id = event.get( 'storeKey' ),
            files = this.inProgress[ id ],
            l, file;
        if ( files ) {
            l = files.length;
            while ( l-- ) {
                file = files[l];
                if ( !file[ source ] ) {
                    files.splice( l, 1 );
                    file.destroy();
                } else {
                    file[ destination ] = true;
                }
            }
            if ( !files.length ) {
                delete this.inProgress[ id ];
            }
        }
        delete this.awaitingSave[ id ];
    },

    save: function ( event ) {
        var awaitingSave = this.awaitingSave[ event.get( 'storeKey' ) ],
            i, l;
        if ( awaitingSave ) {
            for ( i = 0, l = awaitingSave.length; i < l; i += 1 ) {
                this.keepFile( awaitingSave[i][0], awaitingSave[i][1] );
            }
        }
        this.finishEdit( event, 'inEdit', 'inServer' );
        event.getDoppelganger( JMAP.store )
                 .computedPropertyDidChange( 'files' );
    },

    discard: function ( event ) {
        this.finishEdit( event, 'inServer', 'inEdit' );
        event.getDoppelganger( JMAP.calendar.editStore )
                .computedPropertyDidChange( 'files' );
    },

    didUpload: function ( file ) {
        var inEdit = file.inEdit,
            inServer = file.inServer,
            attachment = {
                url: file.get( 'url' ),
                name: file.get( 'name' ),
                type: file.get( 'type' ),
                size: file.get( 'size' )
            },
            editEvent = file.editEvent,
            editAttachments = O.clone( editEvent.get( 'attachments' ) ) || [],
            id, awaitingSave,
            serverEvent, serverAttachments;

        if ( !inServer ) {
            id = editEvent.get( 'storeKey' );
            awaitingSave = this.awaitingSave;
            ( awaitingSave[ id ] ||
                ( awaitingSave[ id ] = [] ) ).push([
                    file.get( 'path' ), file.get( 'name' ) ]);
            editAttachments.push( attachment );
            editEvent.set( 'attachments', editAttachments );
            this.remove( editEvent, file );
        } else {
            this.keepFile( file.get( 'path' ), file.get( 'name' ) );
            // Save new attachment to server
            serverEvent = editEvent.getDoppelganger( JMAP.store );
            serverAttachments =
                O.clone( serverEvent.get( 'attachments' ) ) || [];
            serverAttachments.push( attachment );
            serverEvent.set( 'attachments', serverAttachments );
            // If in edit, push to edit record as well.
            if ( inEdit ) {
                editAttachments.push( attachment );
            }
            editEvent.set( 'attachments', editAttachments );
            this.remove( serverEvent, file );
        }
    },

    didFail: function ( file ) {
        var event = file.editEvent;
        file.inServer = false;
        this.remove( event, file );
        event.getDoppelganger( JMAP.store )
             .computedPropertyDidChange( 'files' );
    },

    keepFile: function ( path, name ) {
        // Move attachment from temp
        JMAP.mail.callMethod( 'moveFile', {
            path: path,
            newPath: 'att:/cal/' + name,
            createFolders: true,
            mayRename: true
        });
    }
};

var CalendarAttachment = O.Class({

    Extends: JMAP.LocalFile,

    init: function ( file, event ) {
        this.editEvent = event;
        this.inServer = false;
        this.inEdit = true;
        CalendarAttachment.parent.init.call( this, file );
    },

    uploadDidSucceed: function () {
        JMAP.calendar.eventUploads.didUpload( this );
    },
    uploadDidFail: function () {
        JMAP.calendar.eventUploads.didFail( this );
    }
});

JMAP.CalendarAttachment = CalendarAttachment;

}( JMAP ) );
