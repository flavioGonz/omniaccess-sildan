-- CreateTable
CREATE TABLE "_AccessGroupToDevice" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_AccessGroupToDevice_AB_unique" ON "_AccessGroupToDevice"("A", "B");

-- CreateIndex
CREATE INDEX "_AccessGroupToDevice_B_index" ON "_AccessGroupToDevice"("B");

-- AddForeignKey
ALTER TABLE "_AccessGroupToDevice" ADD CONSTRAINT "_AccessGroupToDevice_A_fkey" FOREIGN KEY ("A") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AccessGroupToDevice" ADD CONSTRAINT "_AccessGroupToDevice_B_fkey" FOREIGN KEY ("B") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
