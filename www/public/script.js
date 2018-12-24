var socket = io();
socket.emit('load');
socket.on('load', function (msg) {
    //console.log(msg);
    document.getElementById("container").innerHTML += (msg);
});

function updateFile(directory, filename, fileIndex) {
    var html = document.querySelector('#' + directory + '_' + fileIndex).value;
    var data = {
        directory: directory,
        filename: filename,
        fileID: fileIndex,
        text: html
    };
    socket.emit('updatefile', data);
}

function deleteConnection(directory, channel) {
    socket.emit('deleteconnection', [directory, channel]);
}

function createConnection(directory, channel) {
    socket.emit('createconnection', [directory, channel]);
}

function createChannel(directory) {
    // get channel name
    var name = document.getElementById(directory + "_channelInput").value;
    socket.emit('createchannel', name);
}

function channelSearch(directory) {
    // declare variables
    var input, filter, ul, li, a, i, txtValue;
    input = document.getElementById(directory + "_channelInput");
    filter = input.value.toUpperCase();
    ul = document.getElementById(directory + "_channelList");
    li = ul.getElementsByTagName("li");
    // loop through list items
    for (i = 0; i < li.length; i++) {
        a = li[i].getElementsByTagName("a")[0];
        txtValue = a.textContent || a.innerText;
        if (txtValue.toUpperCase().indexOf(filter) > -1) {
            li[i].style.display = "";
        } else {
            li[i].style.display = "none";
        }
    }
}

function createDisk() {
    socket.emit('createdisk');
}