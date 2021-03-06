/// <reference path="../typings/bluebird/bluebird.d.ts"/>
/// <reference path="../typings/winrt/winrt.d.ts"/>
/// <reference path="../built/pxtlib.d.ts"/>
namespace pxtwinrt {
    export function deployCoreAsync(res: ts.pxt.CompileResult): Promise<void> {

        let drives = pxt.appTarget.compile.deployDrives;
        pxt.Util.assert(!!drives);
        pxt.log(`deploying to drives ${drives}`)

        let drx = new RegExp(drives);
        let r = res.outfiles[ts.pxt.BINARY_HEX];

        function writeAsync(folder: Windows.Storage.StorageFolder): Promise<void> {
            pxt.log(`writing .hex to ${folder.displayName}`)
            return pxtwinrt.promisify(
                folder.createFileAsync("firmware.hex", Windows.Storage.CreationCollisionOption.replaceExisting)
                    .then(file => Windows.Storage.FileIO.writeTextAsync(file, r))
            ).then(r => { }).catch(e => {
                pxt.log(`failed to write to ${folder.displayName} - ${e}`)
            })
        }

        return pxtwinrt.promisify(Windows.Storage.KnownFolders.removableDevices.getFoldersAsync())
            .then(ds => {
                let df = ds.filter(d => drx.test(d.displayName));
                let pdf = df.map(writeAsync);
                let all = Promise.join(...pdf)
                return all;
            }).then(r => { });
    }

    export function browserDownloadAsync(text: string, name: string, contentType: string): Promise<void> {
        let file: Windows.Storage.StorageFile;
        return pxtwinrt.promisify<void>(
            Windows.Storage.ApplicationData.current.temporaryFolder.createFileAsync(name, Windows.Storage.CreationCollisionOption.replaceExisting)
                .then(f => Windows.Storage.FileIO.writeTextAsync(file = f, text))
                .then(() => Windows.System.Launcher.launchFileAsync(file))
                .then(b => { })
        );
    }
}