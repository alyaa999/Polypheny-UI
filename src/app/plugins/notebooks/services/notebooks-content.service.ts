import {Injectable} from '@angular/core';
import {NotebooksService} from './notebooks.service';
import {BehaviorSubject, forkJoin, interval, Observable, of, Subject, Subscription} from 'rxjs';
import {
    Content,
    DirectoryContent, KernelSpec,
    KernelSpecs,
    NotebookContent,
    SessionResponse
} from '../models/notebooks-response.model';
import {UrlSegment} from '@angular/router';
import {mergeMap, switchMap, tap} from 'rxjs/operators';
import {Notebook} from '../models/notebook.model';

@Injectable()
export class NotebooksContentService {

    private _path: string;
    private _pathSegments: string[];
    private _type = 'directory';

    private _parentPath: string; // Files: root/parent/current/file.txt
    private _directoryPath: string; // Directories (path = directoryPath):     root/parent/current/
    private _isRoot = true;

    private contentChange = new Subject<null>();

    private _directory: DirectoryContent;
    private _metadata: Content;
    private notebook: Notebook = null;
    private notebookPath: string = null;
    private sessions = new BehaviorSubject<SessionResponse[]>([]);
    private kernelSpecs = new BehaviorSubject<KernelSpecs>(null);
    private invalidLocationSubject = new Subject<string>();
    private updateInterval$: Subscription;

    constructor(private _notebooks: NotebooksService,) {
        this.updateAvailableKernels();
        this.updateSessions();
    }

    updateLocation(url: UrlSegment[]) {
        this._pathSegments = url.map((segment) => decodeURIComponent(segment.toString()));
        this._path = this._pathSegments.join('/');
        this._directoryPath = this._path;
        this._parentPath = null;

        this.update();
    }

    update() {
        this._notebooks.getContents(this._path, false).pipe(
            mergeMap(res => {
                this.updateMetadata(res);
                return this._notebooks.getContents(this._directoryPath, true);
            })
        ).subscribe(
            res => {
                this.updateDirectory(<DirectoryContent>res);
                this.contentChange.next();
            },
            error => this.invalidLocationSubject.next()
        );
    }

    private updateMetadata(res: Content) {
        if (res == null) {
            this.invalidLocationSubject.next();
            return;
        }
        this._type = res.type;
        this._metadata = res;

        this._isRoot = false;
        if (this._type === 'directory') {
            if (this._pathSegments.length === 1) {
                this._isRoot = true;
            } else {
                this._parentPath = this._pathSegments.slice(0, -1).join('/');
            }

        } else {
            this._directoryPath = this._pathSegments.slice(0, -1).join('/');
            if (this._pathSegments.length > 2) {
                this._parentPath = this._pathSegments.slice(0, -2).join('/');
            }
        }
    }

    private updateDirectory(res: DirectoryContent) {
        this._directory = res;
    }

    updateAvailableKernels() {
        this._notebooks.getKernelspecs().subscribe(res => this.kernelSpecs.next(res));
    }

    updateSessions() {
        this._notebooks.getSessions().subscribe(res => this.sessions.next(res));
    }

    hasRunningKernel(path: string) {
        const session = this.sessions.getValue().find(s => s.path.startsWith(path));
        return session !== undefined;
    }

    isCurrentPath(path: string) {
        return path === this._path;
    }

    setAutoUpdate(active: boolean) {
        this.updateInterval$?.unsubscribe();
        if (active) {
            this.updateInterval$ = interval(15000).subscribe(() => {
                this.updateAvailableKernels();
                this.updateSessions();
                this.update();
            });
        }
    }

    addSession(session: SessionResponse) {
        this.sessions.next([...this.sessions.getValue(), session]);
    }

    removeSessions(sessionIds: string[]) {
        const newSessions = this.sessions.getValue().filter(s => !sessionIds.includes(s.id));
        this.sessions.next(newSessions);
    }

    moveSessionsWithFile(fromPath: string, toName: string, toPath: string) {
        const sessionsToMove = this.sessions.getValue().filter(s => s.path.startsWith(fromPath));
        forkJoin(
            sessionsToMove.map(s => {
                const id = this._notebooks.getUniqueIdFromSession(s);
                return this._notebooks.moveSession(s.id, toName + id, toPath + id);
            })
        ).subscribe().add(() => this.updateSessions());
    }

    getSpecifiedKernel(path: string): Observable<KernelSpec> {
        if (path === this.notebookPath && this.notebook) {
            return of(this.getKernelspec(this.notebook.metadata?.kernelspec?.name));
        }
        return this._notebooks.getContents(path, true).pipe(
            tap((res: Content) => {
                this.notebook = (<NotebookContent>res).content;
                this.notebookPath = path;
            }),
            switchMap(() => of(this.getKernelspec(this.notebook.metadata?.kernelspec?.name)))
        );
    }

    private getKernelspec(kernelName: string): KernelSpec {
        return this.kernelSpecs.getValue().kernelspecs[kernelName];
    }

    getSessionsForNotebook(path: string = this.metadata.path): SessionResponse[] {
        return this.sessions.getValue().filter(session => session.path.startsWith(path));
    }

    onContentChange() {
        return this.contentChange;
    }

    onSessionsChange() {
        return this.sessions;
    }

    onKernelSpecsChange() {
        return this.kernelSpecs;
    }

    onDirectoryChange() {
        return this._directory;
    }

    onInvalidLocation() {
        return this.invalidLocationSubject;
    }

    // Getters

    get path(): string {
        return this._path;
    }

    get type(): string {
        return this._type;
    }

    get parentPath(): string {
        return this._parentPath;
    }

    get directoryPath(): string {
        return this._directoryPath;
    }

    get isRoot(): boolean {
        return this._isRoot;
    }

    get pathSegments(): string[] {
        return this._pathSegments;
    }

    get directory(): DirectoryContent {
        return this._directory;
    }

    get metadata(): Content {
        return this._metadata;
    }
}
